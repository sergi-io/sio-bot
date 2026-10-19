import { RiskRewardRatioExitStrategy } from './../strategies/exitStrategies/RiskRewardRatioExitStrategy';
import os from 'os';
import { formatMoney } from '@/utils/money';
import type { SioBot } from '@/siobot/SioBot';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { ALXOrderLimitType, ALXOrderSide, ALXOrderType, type ALXOrder } from '@/domain/ALXOrder';
import type { ClosePositionOptions } from '@/domain/ALXExchange';
import { ExitStrategyAction, type ExitStrategyActionExecuted } from '@/strategies/strategies.types';
import { getCurrentTimestampMs, calcDurationMs } from '@/utils/date';
import { logger, silentLogger } from '@/utils/logger';
import { Telegram } from '@/comms/Telegram';
import { config } from '@/config';
import { RiskStrategyAction } from '@/risk/riskStrategies.types';
import { insertClosedPosition } from '@/utils/db/positionHistory/insertClosedPosition';
import { JournalGenerator } from '@/journal/JournalGenerator';
import { normalizeSymbolString } from '@/utils/symbols';

const BREAKEVEN_NOTIFICATION_COOLDOWN_MS = 10 * 60 * 1000;

type PendingOpenPositionMetadata = {
  openTimestamp: number;
  openedByStrategies?: ALXOrder['openedByStrategies'];
  riskStrategiesExecuted?: ALXOrder['riskStrategiesExecuted'];
};

export type OpenPositionsChangeListener = (positions: ALXPosition[]) => void;

type ClosePositionRequestOptions = {
  forceMarket?: boolean;
};

function getPositionMetadataKey(symbol: string, side: ALXPositionSide): string {
  const normalizedSymbol = normalizeSymbolString(symbol) ?? symbol;
  return `${normalizedSymbol}:${side}`;
}

function mergeUniqueItems<T>(...groups: Array<T[] | undefined>): T[] | undefined {
  const merged = new Map<string, T>();

  for (const group of groups) {
    for (const item of group ?? []) {
      merged.set(JSON.stringify(item), item);
    }
  }

  return merged.size > 0 ? Array.from(merged.values()) : undefined;
}

function mergePositionState(params: {
  fetchedPosition: ALXPosition;
  existingPosition?: ALXPosition;
  pendingMetadata?: PendingOpenPositionMetadata;
}): ALXPosition {
  const { fetchedPosition, existingPosition, pendingMetadata } = params;

  const openTimestamp = Math.min(
    fetchedPosition.openTimestamp,
    existingPosition?.openTimestamp ?? Number.POSITIVE_INFINITY,
    pendingMetadata?.openTimestamp ?? Number.POSITIVE_INFINITY
  );

  const minRealizedPnlCandidates = [
    fetchedPosition.minRealizedPnl,
    existingPosition?.minRealizedPnl,
  ].filter((value): value is number => value !== undefined);
  const maxRealizedPnlCandidates = [
    fetchedPosition.maxRealizedPnl,
    existingPosition?.maxRealizedPnl,
  ].filter((value): value is number => value !== undefined);

  return {
    ...fetchedPosition,
    openTimestamp: Number.isFinite(openTimestamp) ? openTimestamp : fetchedPosition.openTimestamp,
    unrealizedPnl: existingPosition?.unrealizedPnl ?? fetchedPosition.unrealizedPnl,
    realizedPnl: existingPosition?.realizedPnl ?? fetchedPosition.realizedPnl,
    enterFee: existingPosition?.enterFee ?? fetchedPosition.enterFee,
    exitFee: existingPosition?.exitFee ?? fetchedPosition.exitFee,
    openedByStrategies: mergeUniqueItems(
      existingPosition?.openedByStrategies,
      fetchedPosition.openedByStrategies,
      pendingMetadata?.openedByStrategies
    ),
    riskStrategiesExecuted: mergeUniqueItems(
      existingPosition?.riskStrategiesExecuted,
      fetchedPosition.riskStrategiesExecuted,
      pendingMetadata?.riskStrategiesExecuted
    ),
    mae: Math.max(fetchedPosition.mae, existingPosition?.mae ?? 0),
    minRealizedPnl:
      minRealizedPnlCandidates.length > 0 ? Math.min(...minRealizedPnlCandidates) : undefined,
    maxRealizedPnl:
      maxRealizedPnlCandidates.length > 0 ? Math.max(...maxRealizedPnlCandidates) : undefined,
    breakevenLastNotifiedTimestamp:
      existingPosition?.breakevenLastNotifiedTimestamp ??
      fetchedPosition.breakevenLastNotifiedTimestamp,
  };
}

function mergeClosedPositionState(params: {
  memoryPosition: ALXPosition;
  exchangePosition: ALXPosition;
}): ALXPosition {
  const { memoryPosition, exchangePosition } = params;

  return {
    ...memoryPosition,
    ...exchangePosition,
    id: memoryPosition.id,
    symbol: memoryPosition.symbol,
    side: memoryPosition.side,
    openTimestamp: memoryPosition.openTimestamp,
    openedByStrategies: memoryPosition.openedByStrategies,
    riskStrategiesExecuted: memoryPosition.riskStrategiesExecuted,
    closedByStrategy: memoryPosition.closedByStrategy,
    minRealizedPnl: Math.min(
      memoryPosition.minRealizedPnl ?? exchangePosition.realizedPnl,
      exchangePosition.minRealizedPnl ?? exchangePosition.realizedPnl
    ),
    maxRealizedPnl: Math.max(
      memoryPosition.maxRealizedPnl ?? exchangePosition.realizedPnl,
      exchangePosition.maxRealizedPnl ?? exchangePosition.realizedPnl
    ),
    mae: Math.max(memoryPosition.mae, exchangePosition.mae),
  };
}

export class PositionManager {
  private openPositions: Record<string, ALXPosition> = {};
  private closedPositions: Record<string, ALXPosition> = {};
  private closingPositionIds: Set<string> = new Set();
  private pendingOpenPositionMetadata: Map<string, PendingOpenPositionMetadata> = new Map();
  private autoEnterCooldownBySymbol: Map<string, number> = new Map();
  private openPositionsChangeListeners = new Set<OpenPositionsChangeListener>();
  private bot: SioBot;
  private logger: typeof logger = logger;

  constructor(bot: SioBot) {
    this.bot = bot;
    if (this.bot.isBackTesting()) {
      this.logger = silentLogger as typeof logger;
    }
  }

  public async closePosition(
    positionId: ALXPosition['id'],
    exitStrategy: ExitStrategyActionExecuted,
    options: ClosePositionRequestOptions = {}
  ): Promise<void> {
    if (this.closingPositionIds.has(positionId)) {
      this.logger.warn(`PositionManager: Close already in progress for position ${positionId}`);
      return;
    }

    const position = this.openPositions[positionId];
    if (!position) {
      const msg = `⚠️ PositionManager: Attempted to close non-existent position with id ${positionId}`;
      this.logger.warn(msg);
      Telegram.sendMessage(msg);
      return;
    }
    this.closingPositionIds.add(positionId);

    try {
      const closeTimestamp = this.bot.isBackTesting()
        ? exitStrategy.kline.timestamp
        : getCurrentTimestampMs();

      const closePositionDraft: ALXPosition = {
        ...position,
        closePrice: exitStrategy.kline.close,
        closeTimestamp,
        closedByStrategy: exitStrategy,
      };

      const exchangeClosedPosition = await this.bot.exchange.closePosition(
        closePositionDraft,
        this.getExchangeClosePositionOptions(closePositionDraft, options)
      );
      const closedPosition = mergeClosedPositionState({
        memoryPosition: closePositionDraft,
        exchangePosition: exchangeClosedPosition,
      });
      const normalizedSymbol =
        normalizeSymbolString(closedPosition.symbol) ?? closedPosition.symbol;
      this.autoEnterCooldownBySymbol.set(normalizedSymbol, closedPosition.closeTimestamp!);

      await this.registerClosedPosition(closedPosition);

      delete this.openPositions[positionId];
      this.emitOpenPositionsChange();
      await this.bot.releaseClosedPositionMarketData(closedPosition.symbol);

      // @TODO: Update balance properly when using leverage and account for fees
      // we only can lose the margin we put in
      const finalPnl = Math.max(closedPosition.realizedPnl, closedPosition.margin * -1);

      let msg = `Closing position (${closedPosition.symbol})` + os.EOL;
      msg += `- PNL: ${formatMoney(finalPnl)}` + os.EOL;
      msg +=
        `- Side: ${closedPosition.side === ALXPositionSide.LONG ? 'LONG' : 'SHORT'} - Leverage: ${closedPosition.leverage}x` +
        os.EOL;
      msg +=
        `- Position Size: ${formatMoney(closedPosition.quantity * closedPosition.entryPrice)}` +
        os.EOL;
      msg += `- Potential Max PNL: 📈 ${formatMoney(closedPosition.maxRealizedPnl!)}` + os.EOL;
      msg += `- Potential Min PNL: 📉 ${formatMoney(closedPosition.minRealizedPnl!)}` + os.EOL;
      msg += `- MAE: ${closedPosition.mae.toFixed(2)}%` + os.EOL;
      msg +=
        `- Duration: 🕰️ ${calcDurationMs(closedPosition.openTimestamp, closedPosition.closeTimestamp!)}` +
        os.EOL;
      if (finalPnl >= 0) {
        msg = `🟢 ${msg}`;
      } else {
        msg = `🔴 ${msg}`;
      }

      // Get balance snapshot for logging
      const balanceSnapshot = this.bot.exchange.balanceManager.getBalanceSnapshot();
      msg += `- Close Strategy: ${exitStrategy.strategyName}` + os.EOL;
      msg += `- Final Balance: ${formatMoney(balanceSnapshot.total)}` + os.EOL;

      this.logger.info(msg);
      if (!this.bot.isBackTesting()) {
        Telegram.sendMessage(msg);
      }

      if (!this.bot.isBackTesting()) {
        await this.bot.exchange.syncBalance('USDT');

        if (config.configOptimizer.runAfterEveryTrade) {
          await this.bot.runConfigOptimizer();
        }
      }
    } finally {
      this.closingPositionIds.delete(positionId);
    }
  }

  private async registerClosedPosition(closedPosition: ALXPosition): Promise<void> {
    this.closedPositions[closedPosition.id] = closedPosition;
    if (!this.bot.isBackTesting()) {
      const botConfig = this.bot.config.getSerializedConfig();
      await insertClosedPosition(closedPosition, botConfig);
      this.logger.info(`Position ${closedPosition.id} saved to history database.`);
      const journalGenerator = new JournalGenerator();
      journalGenerator.regenerate().catch((err) => {
        this.logger.error(`Failed to regenerate journal: ${err.message}`);
      });
    }
  }

  private getExchangeClosePositionOptions(
    position: ALXPosition,
    options: ClosePositionRequestOptions
  ): ClosePositionOptions {
    if (
      options.forceMarket ||
      !this.bot.config.marketScannerLimitOrders_Enabled.value ||
      !this.wasOpenedByMarketScanner(position)
    ) {
      return { orderType: ALXOrderType.MARKET };
    }

    const closePrice = position.closePrice ?? position.entryPrice;
    const offsetRate = Math.max(this.bot.config.marketScannerLimitOrders_OffsetRate.value, 0);
    const price =
      position.side === ALXPositionSide.LONG
        ? closePrice * (1 + offsetRate)
        : closePrice * (1 - offsetRate);

    return {
      orderType: ALXOrderType.LIMIT,
      limitType: ALXOrderLimitType.POST_ONLY,
      price,
    };
  }

  private wasOpenedByMarketScanner(position: ALXPosition): boolean {
    return (position.openedByStrategies ?? []).some(
      (strategy) => strategy.strategyName === 'MarketScannerAutoEnter'
    );
  }

  public getPositionById(positionId: ALXPosition['id']): ALXPosition | undefined {
    return this.openPositions[positionId];
  }

  public getOpenPositions(): ALXPosition[] {
    return this.openPositions ? Object.values(this.openPositions) : [];
  }

  public onOpenPositionsChange(listener: OpenPositionsChangeListener): () => void {
    this.openPositionsChangeListeners.add(listener);

    return () => {
      this.openPositionsChangeListeners.delete(listener);
    };
  }

  private emitOpenPositionsChange(): void {
    const positions = this.getOpenPositions();

    for (const listener of this.openPositionsChangeListeners) {
      listener(positions);
    }
  }

  public getClosedPositions(): ALXPosition[] {
    return this.closedPositions ? Object.values(this.closedPositions) : [];
  }

  public getNumOpenedPositions(): number {
    return this.getOpenPositions().length;
  }

  public hasOpenPositionForSymbol(symbol: string): boolean {
    const normalizedAsset = normalizeSymbolString(symbol) ?? symbol;

    return Object.values(this.openPositions).some((position) => {
      const normalizedPositionSymbol = normalizeSymbolString(position.symbol) ?? position.symbol;
      return normalizedPositionSymbol === normalizedAsset;
    });
  }

  public getAutoEnterCooldownRemainingMs(symbol: string, currentTimestamp: number): number {
    const normalizedSymbol = normalizeSymbolString(symbol) ?? symbol;
    const lastClosedTimestamp = this.autoEnterCooldownBySymbol.get(normalizedSymbol);
    if (lastClosedTimestamp === undefined) {
      return 0;
    }

    const cooldownMs = this.bot.config.assetAutoReentryCooldownSeconds.value * 1000;
    return Math.max(0, lastClosedTimestamp + cooldownMs - currentTimestamp);
  }

  public isAutoEnterOnCooldown(symbol: string, currentTimestamp: number): boolean {
    return this.getAutoEnterCooldownRemainingMs(symbol, currentTimestamp) > 0;
  }

  public registerPendingOpenOrder(order: ALXOrder): void {
    const side = order.side === ALXOrderSide.BUY ? ALXPositionSide.LONG : ALXPositionSide.SHORT;
    const metadataKey = getPositionMetadataKey(order.symbol, side);
    const existingMetadata = this.pendingOpenPositionMetadata.get(metadataKey);

    this.pendingOpenPositionMetadata.set(metadataKey, {
      openTimestamp: Math.min(
        existingMetadata?.openTimestamp ?? Number.POSITIVE_INFINITY,
        order.openedTimestamp
      ),
      openedByStrategies: mergeUniqueItems(
        existingMetadata?.openedByStrategies,
        order.openedByStrategies
      ),
      riskStrategiesExecuted: mergeUniqueItems(
        existingMetadata?.riskStrategiesExecuted,
        order.riskStrategiesExecuted
      ),
    });
  }

  public getPositionPnlByClosePrice(position: ALXPosition, closePrice: number): number {
    const fees = this.bot.exchange.getFeeRateBySymbol(position.symbol);
    const enterFee = position.quantity * position.entryPrice * (fees?.takerRate / 100);
    const exitFee = position.quantity * closePrice * (fees?.takerRate / 100);

    let unrealizedPnl = 0;

    if (position.side === ALXPositionSide.LONG) {
      unrealizedPnl = (closePrice - position.entryPrice) * position.quantity - enterFee;
    } else {
      unrealizedPnl = (position.entryPrice - closePrice) * position.quantity - enterFee;
    }
    const realizedPnl = unrealizedPnl - exitFee;

    return realizedPnl;
  }

  public async recalculatePositions(symbol?: string): Promise<void> {
    let didUpdatePosition = false;
    const normalizedTargetSymbol = symbol ? (normalizeSymbolString(symbol) ?? symbol) : null;

    for (const position of Object.values(this.openPositions)) {
      const normalizedPositionSymbol = normalizeSymbolString(position.symbol) ?? position.symbol;
      if (normalizedTargetSymbol !== null && normalizedPositionSymbol !== normalizedTargetSymbol) {
        continue;
      }

      const currentPrice = this.bot.exchange.getCurrentPrice(
        position.symbol,
        this.bot.config.timeFrameToTrade
      );

      if (currentPrice === null) {
        // this.logger.warn(
        //   `PositionManager: Cannot fetch current price for symbol ${position.symbol} to recalculate position`
        // );
        continue;
      }
      let unrealizedPnl = 0;
      let realizedPnl = 0;

      const fees = this.bot.exchange.getFeeRateBySymbol(position.symbol);
      // @TODO : considering only MARKET orders for now
      const enterFee = position.quantity * position.entryPrice * (fees?.takerRate / 100);
      const exitFee = position.quantity * currentPrice * (fees?.takerRate / 100);

      position.enterFee = enterFee;
      position.exitFee = exitFee;

      if (position.side === ALXPositionSide.LONG) {
        unrealizedPnl = (currentPrice - position.entryPrice) * position.quantity - enterFee;
      } else {
        unrealizedPnl = (position.entryPrice - currentPrice) * position.quantity - enterFee;
      }
      realizedPnl = unrealizedPnl - exitFee;
      position.unrealizedPnl = unrealizedPnl;
      position.realizedPnl = realizedPnl;
      // Calculate max and min unrealized PnL
      if (position.maxRealizedPnl === undefined) {
        position.maxRealizedPnl = Number.NEGATIVE_INFINITY;
      }
      if (position.minRealizedPnl === undefined) {
        position.minRealizedPnl = Number.POSITIVE_INFINITY;
      }
      if (realizedPnl > position.maxRealizedPnl) {
        position.maxRealizedPnl = realizedPnl;
      }
      if (realizedPnl < position.minRealizedPnl) {
        position.minRealizedPnl = realizedPnl;
      }

      position.mae = Math.abs(
        Math.min(0, ((position.minRealizedPnl ?? 0) / (position.margin || 1)) * 100)
      );
      didUpdatePosition = true;

      if (!this.bot.isBackTesting()) {
        // const msg = this.getPositionLogEntry(position);
        // this.logger.info(msg);
      }

      // SlowMotion:
      // Enable this line to simulate the position updates in slow motion, which can be useful to analyze the position behavior and the strategy performance in more detail. You can adjust the delay time as needed.
      // console.log(this.getPositionLogEntry(position));

      // #################################################################
      // # Liquidation ___ this might need to be implemented in the exchange
      // #################################################################
      if (realizedPnl <= -1 * position.margin) {
        const msg = `⚠️ Position on ${position.symbol} has been liquidated! Unrealized PnL: ${formatMoney(unrealizedPnl)}`;
        this.logger.warn(msg);
        Telegram.sendMessage(msg);
        const exitStrategy: ExitStrategyActionExecuted = {
          strategyName: 'Liquidated!',
          params: {},
          action: ExitStrategyAction.EXIT_CLOSE,
          kline: this.bot.exchange
            .getKlinesBuffer(position.symbol, this.bot.config.timeFrameToTrade)!
            .getLast()!,
        };
        await this.closePosition(position.id, exitStrategy);
      }
    }

    if (didUpdatePosition) {
      this.emitOpenPositionsChange();
    }
  }

  private notifyBreakevenRecovery(position: ALXPosition, previousRealizedPnl: number): void {
    const recoveredFromNegative = previousRealizedPnl < 0 && position.realizedPnl >= 0;

    if (!recoveredFromNegative) {
      return;
    }

    const now = getCurrentTimestampMs();
    const cooldownElapsed =
      position.breakevenLastNotifiedTimestamp === undefined ||
      now - position.breakevenLastNotifiedTimestamp >= BREAKEVEN_NOTIFICATION_COOLDOWN_MS;

    if (!cooldownElapsed) {
      return;
    }

    position.breakevenLastNotifiedTimestamp = now;

    const msg = `⚖️ Position (${position.symbol}) is back to breakeven.`;
    this.logger.info(msg);
    Telegram.sendMessage(msg);
  }

  public getPositionLogEntry(position: ALXPosition): string {
    // Leverage is already considered in quantity
    const usdAmount = position.quantity * position.entryPrice;
    const side = position.side === ALXPositionSide.LONG ? 'L' : 'S';
    const leverage = position.leverage;
    const lastTimestamp = this.bot.isBackTesting()
      ? (this.bot.exchange
          .getKlinesBuffer(position.symbol, this.bot.config.timeFrameToTrade)!
          .getLast()?.timestamp ?? getCurrentTimestampMs())
      : getCurrentTimestampMs();
    const duration = calcDurationMs(position.openTimestamp, lastTimestamp);

    let output = `(${position.symbol}) ${side}@${leverage}x | Margin: ${formatMoney(position.margin)} | Total: ${formatMoney(usdAmount)} | ⏱️ ${duration}`;
    output += os.EOL;
    output += `🚀 PNL: ${formatMoney(position.realizedPnl)} | 📈 ${formatMoney(position?.maxRealizedPnl ?? 0)} | 📉 ${formatMoney(position?.minRealizedPnl ?? 0)} | Entry: ${formatMoney(position.entryPrice)}`;
    return output;
  }

  public getPositionLogMsg(position: ALXPosition): string {
    let msg = `Position (${position.symbol})` + os.EOL;
    msg += `- PNL: ${formatMoney(position.realizedPnl)}` + os.EOL;
    msg +=
      `- Side: ${position.side === ALXPositionSide.LONG ? 'LONG' : 'SHORT'} - Leverage: ${position.leverage}x` +
      os.EOL;
    msg += `- Position Size: ${formatMoney(position.quantity * position.entryPrice)}` + os.EOL;
    msg += `- Potential Max PNL: 📈 ${formatMoney(position.maxRealizedPnl!)}` + os.EOL;
    msg += `- Potential Min PNL: 📉 ${formatMoney(position.minRealizedPnl!)}` + os.EOL;
    msg += `- MAE: ${position.mae.toFixed(2)}%` + os.EOL;
    msg +=
      `- Duration: 🕰️ ${calcDurationMs(position.openTimestamp, position.closeTimestamp! ?? getCurrentTimestampMs())}` +
      os.EOL;
    if (position.realizedPnl >= 0) {
      msg = `🟢 ${msg}`;
    } else {
      msg = `🔴 ${msg}`;
    }

    // If DCA is enabled and position was opened by risk-reward strategies, log them
    if (this.bot.config.dcaRiskStrategy_Enabled.value == true) {
      const dcaExecuted = position.riskStrategiesExecuted?.filter(
        (s) => s.action === RiskStrategyAction.DCA
      );

      if (dcaExecuted) {
        msg +=
          `- DCA executed: ${dcaExecuted.length} / ${this.bot.config.dcaRiskStrategy_MaxTimes.value}` +
          os.EOL;
      }
    }

    // If risk-reward strategies are enabled, log them
    const riskRewardRatio =
      position.openedByStrategies?.reduce((minRatio, strategy) => {
        return Math.min(minRatio, strategy.params.riskRewardRatio);
      }, Infinity) || 0;

    if (riskRewardRatio > 0) {
      const riskRewardStrategy = new RiskRewardRatioExitStrategy(this.bot, {
        stopLossThresholdRate:
          this.bot.config.riskRewardRatioExitStrategy_StopLossThresholdRate.value,
      });
      const riskRewardOutput = riskRewardStrategy.getExits(
        position,
        this.bot.config.riskRewardRatioExitStrategy_StopLossThresholdRate.value,
        riskRewardRatio
      );

      if (riskRewardOutput) {
        msg += `- 📊 Risk-Reward Ratio: ${riskRewardRatio.toFixed(2)} ` + os.EOL;
        msg += `- 🟩 Win Exit at PNL:  ${formatMoney(riskRewardOutput.rewardPnl!)} ` + os.EOL;
        msg += `- 🟥 Loss Exit at PNL: ${formatMoney(riskRewardOutput.stopLossPnl!)} ` + os.EOL;
      }
    }
    return msg;
  }

  private async registerExchangeClosedPositions(
    previousPositions: Record<string, ALXPosition>,
    currentPositions: Record<string, ALXPosition>
  ): Promise<void> {
    if (this.bot.isBackTesting()) {
      return;
    }

    const currentPositionKeys = new Set(
      Object.values(currentPositions).map((position) =>
        getPositionMetadataKey(position.symbol, position.side)
      )
    );

    for (const previousPosition of Object.values(previousPositions)) {
      const previousPositionKey = getPositionMetadataKey(
        previousPosition.symbol,
        previousPosition.side
      );

      if (currentPositions[previousPosition.id] || currentPositionKeys.has(previousPositionKey)) {
        continue;
      }

      const exchangeClosedPosition = await this.bot.exchange.getClosedPosition(previousPosition);
      if (!exchangeClosedPosition) {
        this.logger.warn(
          `PositionManager: position ${previousPosition.id} disappeared from exchange, but closed PnL could not be fetched. Skipping history insert.`
        );
        continue;
      }

      const closedPosition = mergeClosedPositionState({
        memoryPosition: previousPosition,
        exchangePosition: exchangeClosedPosition,
      });
      const normalizedSymbol = normalizeSymbolString(closedPosition.symbol) ?? closedPosition.symbol;
      this.autoEnterCooldownBySymbol.set(normalizedSymbol, closedPosition.closeTimestamp!);
      await this.registerClosedPosition(closedPosition);
      await this.bot.releaseClosedPositionMarketData(closedPosition.symbol);
      this.logger.info(
        `PositionManager: archived externally closed position ${closedPosition.id} with exchange PnL ${formatMoney(closedPosition.realizedPnl)}.`
      );
    }
  }

  public syncPositionsFromExchange = async (): Promise<void> => {
    if (!this.bot.isBackTesting()) {
      this.logger.debug(`🔄 PositionManager: Syncing positions from exchange...`);
    }
    const positionsFromExchange = await this.bot.exchange.getOpenPositions();
    const previousPositions = this.openPositions;
    const previousPositionsByKey = new Map<string, ALXPosition>();

    for (const position of Object.values(previousPositions)) {
      previousPositionsByKey.set(getPositionMetadataKey(position.symbol, position.side), position);
    }

    this.openPositions = {};
    for (const position of positionsFromExchange) {
      const metadataKey = getPositionMetadataKey(position.symbol, position.side);
      const existingPosition =
        previousPositions[position.id] ?? previousPositionsByKey.get(metadataKey);
      const pendingMetadata = this.pendingOpenPositionMetadata.get(metadataKey);
      const mergedPosition = mergePositionState({
        fetchedPosition: position,
        existingPosition,
        pendingMetadata,
      });

      this.openPositions[mergedPosition.id] = mergedPosition;
      if (pendingMetadata) {
        this.pendingOpenPositionMetadata.delete(metadataKey);
      }
    }
    await this.registerExchangeClosedPositions(previousPositions, this.openPositions);
    if (!this.bot.isBackTesting()) {
      this.logger.debug(
        `✅ PositionManager: Synced ${positionsFromExchange.length} positions from exchange.`
      );
    }
    this.emitOpenPositionsChange();
  };
}
