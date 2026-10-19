import os from 'os';
import { nanoid } from 'nanoid';
import { BotRunMode, BotState } from './constants';
import { type ALXExchange } from '@/domain/ALXExchange';
import { type BotConfig } from './BotConfig';
import { logger, silentLogger } from '@/utils/logger';
import { TAManager } from '@/ta/TAManager';
import { StrategyManager } from '@/strategies/StrategyManager';
import { config } from '@/config';
import { RiskManager } from '@/risk/RiskManager';
import { OrderManager } from '@/orders/OrderManager';
import { PositionManager } from '@/positions/PositionManager';
import { ConfigOptimizer } from '@/backtester/configOptimizer/ConfigOptimizer';
import { getAvailableCpuCores } from '@/utils/cpuCores';
import { downloadHistoricalData } from '@/utils/klines/downloadHistoricalData';
import { formatDateFromMs, formatDurationMs } from '@/utils/date';
import ansis from 'ansis';
import { formatMoney } from '@/utils/money';
import { Telegram } from '@/comms/Telegram';
import { ALXTimeFramesMsMap, type ALXTimeFrame } from '@/domain/ALXTimeFrame';
import type { ALXKline } from '@/domain/ALXKline';
import { formatPerformanceMetric } from '@/backtester/performanceMetrics';
import {
  NexusMarketScannerSocketClient,
  type NexusMarketScannerSnapshot,
  type NexusMarketScannerSymbolStats,
} from '@/exchanges/NexusMarketScannerSocketClient';
import { normalizeSymbolString } from '@/utils/symbols';
import {
  EnterStrategyAction,
  type EnterStrategyActionExecuted,
} from '@/strategies/strategies.types';
import { ALXOrderLimitType, ALXOrderType } from '@/domain/ALXOrder';
import { sleep } from 'bun';
import { ManualEnterStrategy } from '@/strategies/enterStrategies/ManualEnterStrategy';
import { getBotPaused, setBotPaused } from '@/utils/db/botConfig/botConfigDB';

interface BotConstructorParams {
  id?: string;
  exchange: ALXExchange;
  botConfig: BotConfig;
  mode?: BotRunMode;
}

type MarketScannerDeltaDecision = {
  action: EnterStrategyAction;
  confirmedCandidate: NexusMarketScannerSymbolStats;
  volumeDelta: number;
  volumeDeltaImbalance: number;
  recentVolumeDelta: number | null;
  recentVolumeDeltaImbalance: number | null;
  source: 'recent' | 'rolling';
  weightedPriceChangePct: number;
  maxAbsPriceChangePct: number;
  priceAlignmentScore: number;
  tradesPerSecond: number;
  totalScore: number;
};

const MARKET_SCANNER_AUTO_ENTER_CANDIDATES_LIMIT = 4;
const MARKET_SCANNER_PRICE_CHANGE_WEIGHTS = {
  priceChange1mPct: 0.2,
  priceChange5mPct: 0.35,
  priceChange15mPct: 0.45,
} as const;

export class SioBot {
  private state: BotState;
  private id: string;
  public mode: BotRunMode = BotRunMode.PAPER_TRADE;
  public exchange: ALXExchange;
  public config: BotConfig;
  public taManager: TAManager;
  public strategyManager: StrategyManager;
  public orderManager: OrderManager;
  public riskManager: RiskManager;
  public positionManager: PositionManager;
  private logger: typeof logger = logger;
  private secondsSinceLastOptimization: number = 0;
  private scannerClient: NexusMarketScannerSocketClient | null = null;
  private scannerAutoEnterInProgress = false;
  private marketScannerModeEnabled = false;
  private lastMarketScannerAutoEnterCheckAt = 0;
  private scannerSnapshotUnsubscribe: (() => void) | null = null;
  private subscribedTradingSymbols = new Set<string>();

  constructor({ id, exchange, botConfig, mode }: BotConstructorParams) {
    if (mode) {
      this.mode = mode;
    }
    if (this.isBackTesting()) {
      this.logger = silentLogger as typeof logger;
    }
    this.id = id ?? nanoid();
    this.config = botConfig;
    this.marketScannerModeEnabled = botConfig.marketScannerAutoEnter_Enabled.value;
    this.taManager = new TAManager(this);
    this.strategyManager = new StrategyManager(this);
    this.riskManager = new RiskManager(this);
    this.orderManager = new OrderManager(this);
    this.positionManager = new PositionManager(this);
    this.state = BotState.INITIALIZING;
    this.exchange = exchange;
  }

  public getState(): BotState {
    return this.state;
  }

  public async run() {
    this.logger.info(`🚀 Bot ${this.id} is starting...`);
    await this.syncExchangeSettings();
    // await this.warmUpBuffers();

    const isPaused = !this.isBackTesting() && (await getBotPaused());
    this.state = isPaused ? BotState.PAUSED : BotState.LOOKING_FOR_TRADES;
    if (isPaused) {
      this.logger.info(`🤖 Bot ${this.id} is paused from persisted BOTConfig.`);
    } else {
      this.marketScannerModeEnabled = true;
    }

    if (!this.isBackTesting()) {
      this.logger.info(`🤖 Setting up Config Optimizer Scheduler...`);
      await this.setupConfigOptimizerScheduler();

      if (config.configOptimizer.runAtStartup && this.state !== BotState.PAUSED) {
        this.logger.info(`🤖 Running Config Optimizer (Run at startup is enabled)...`);
        // Only run if there are no opened positions
        if ((await this.exchange.getOpenPositions()).length === 0) {
          await this.runConfigOptimizer();
          this.logger.info(`🤖 Config Optimizer completed, resuming normal operation...`);
        } else {
          this.logger.info(
            `🤖 Skipping Config Optimizer run at startup because there are open positions.`
          );
        }
      }
    }
    if (this.state === BotState.LOOKING_FOR_TRADES) {
      this.logger.info(`🤖 Bot ${this.id} is now looking for trades...`);
    }

    if (!this.isBackTesting()) {
      await this.setupMarketScannerClient();
    }

    await this.subscribeEvents();
  }

  public isMarketScannerModeEnabled(): boolean {
    return this.marketScannerModeEnabled;
  }

  public getMarketScannerSnapshot(): NexusMarketScannerSnapshot | null {
    return this.scannerClient?.getLatestSnapshot() ?? null;
  }

  public async ensureMarketScannerClientConnected(): Promise<void> {
    if (this.isBackTesting()) {
      throw new Error('Market scanner is not available while backtesting');
    }

    await this.setupMarketScannerClient();
  }

  public async setMarketScannerModeEnabled(enabled: boolean): Promise<void> {
    if (this.isBackTesting()) {
      throw new Error('Market scanner mode is not available while backtesting');
    }

    if (this.marketScannerModeEnabled === enabled) {
      return;
    }

    this.marketScannerModeEnabled = enabled;

    if (!enabled) {
      this.logger.info('🎰 Market scanner mode disabled.');
      return;
    }

    await this.setupMarketScannerClient();
    this.logger.info('🎰 Market scanner mode enabled.');
  }

  public async openManualScannerPosition(rawSymbol: string, side: 'long' | 'short'): Promise<void> {
    if (this.isBackTesting()) {
      throw new Error('Manual scanner entries are not available while backtesting');
    }

    const symbol = normalizeSymbolString(rawSymbol);
    if (!symbol) {
      throw new Error(`Invalid symbol: ${rawSymbol}`);
    }

    if (this.positionManager.hasOpenPositionForSymbol(symbol)) {
      throw new Error(`There is already an open position for ${symbol}`);
    }

    await this.ensureSymbolMarketData(symbol);

    let klineBuffer = this.exchange.getKlinesBuffer(symbol, this.config.timeFrameToTrade);
    if (!klineBuffer?.getLast()) {
      this.bootstrapSymbolKlineFromMarketScanner(symbol);
      klineBuffer = this.exchange.getKlinesBuffer(symbol, this.config.timeFrameToTrade);
    }

    if (!klineBuffer?.getLast()) {
      throw new Error(`No ${this.config.timeFrameToTrade} kline buffer available for ${symbol}`);
    }

    const manualEnterStrategyExecuted = new ManualEnterStrategy(this, {
      enterSide: side,
    }).execute(klineBuffer);

    if (!manualEnterStrategyExecuted) {
      throw new Error(`Unable to create manual ${side.toUpperCase()} entry for ${symbol}`);
    }

    const margin = await this.riskManager.calculateOrderSize();
    await this.orderManager.openOrderMarket([manualEnterStrategyExecuted], margin, {
      isManual: true,
    });
  }

  // #################################################################
  // # Sync Exchange Settings
  // #################################################################

  private async syncExchangeSettings() {
    this.logger.info(`🤖 Syncing exchange settings...`);
    await this.exchange.syncBalance('USDT');
    await this.exchange.syncFeeRates();
    const assetSymbol = this.config.assetSymbol;
    this.logger.info(
      `🤖 FeeRates for ${assetSymbol}...` +
        os.EOL +
        JSON.stringify(this.exchange.getFeeRateBySymbol(assetSymbol), null, 2)
    );
    await this.positionManager.syncPositionsFromExchange();

    // Log balance state with available/locked breakdown
    const snapshot = this.exchange.balanceManager.getBalanceSnapshot();
    this.logger.info(
      `✅ Exchange settings synced. Total: ${snapshot.total.toFixed(2)} USDT, ` +
        `Available: ${snapshot.available.toFixed(2)} USDT, ` +
        `Locked: ${snapshot.locked.toFixed(2)} USDT, ` +
        `Positions: ${Object.keys(snapshot.positions).length}`
    );
  }

  // #################################################################
  // # WARM UP
  // #################################################################
  // private async warmUpBuffers() {
  //   const requestedWarmUpKlines = config.defaults.buffer.size;
  //   this.logger.info(`🤖 Waiting to warming up buffers with exchange history...`);
  //   const warmUpTimeframes = this.getSubscribedTimeframes();

  //   // Initialize klines buffer from the history
  //   await this.exchange.warmUpKlinesBuffer(
  //     this.config.assetSymbol,
  //     warmUpTimeframes,
  //     requestedWarmUpKlines
  //   );

  //   const klines = this.getWarmedKlines(warmUpTimeframes);

  //   const tradeKlinesBuffer = this.exchange.getKlinesBuffer(
  //     this.config.assetSymbol,
  //     this.config.timeFrameToTrade
  //   );
  //   const tradeKlinesBuffered = tradeKlinesBuffer?.size ?? 0;

  //   if (tradeKlinesBuffered === 0) {
  //     const errorMessage =
  //       `Unable to warm up buffers for ${this.config.assetSymbol}:${this.config.timeFrameToTrade}. ` +
  //       `No historical klines were loaded.`;
  //     this.logger.error(errorMessage);
  //     console.error(errorMessage);
  //     process.exit(1);
  //   }

  //   // Warm up TA indicators
  //   klines.forEach((kline) => {
  //     this.taManager.addKline(kline);
  //   });

  //   const indicatorSnapshots = this.taManager.getRegisteredIndicatorSnapshots();
  //   const unstableIndicators = indicatorSnapshots.filter((indicator) => !indicator.isStable);

  //   if (unstableIndicators.length > 0) {
  //     const unstableSummary = unstableIndicators
  //       .map((indicator) => `${indicator.id}(${indicator.bufferSize})`)
  //       .join(', ');
  //     this.logger.warn(
  //       `⚠️ Warm-up completed with unstable indicators for ${this.config.assetSymbol}:${this.config.timeFrameToTrade}. ` +
  //         `Trade timeframe buffer=${tradeKlinesBuffered}/${requestedWarmUpKlines}. Unstable: ${unstableSummary}`
  //     );
  //   }

  //   this.logger.info(
  //     `✅ Buffers are warmed up! (${tradeKlinesBuffered} ${this.config.timeFrameToTrade} klines buffered / ` +
  //       `${requestedWarmUpKlines} requested, indicators stable ${indicatorSnapshots.length - unstableIndicators.length}/${indicatorSnapshots.length})`
  //   );
  // }

  // private getWarmedKlines(timeframes: ALXTimeFrame[]): ALXKline[] {
  //   return timeframes
  //     .flatMap(
  //       (timeframe) =>
  //         this.exchange.getKlinesBuffer(this.config.assetSymbol, timeframe)?.toArray() ?? []
  //     )
  //     .sort((a, b) => a.timestamp - b.timestamp);
  // }

  private getSubscribedTimeframes(): ALXTimeFrame[] {
    const timeframes = new Set<ALXTimeFrame>([
      ...this.config.timeFramesFromNexus,
      this.config.timeFrameToTrade,
      this.config.timeFrameToDetectRegime,
    ]);

    if (this.config.microTrendRetestBreakEnterStrategy_Enabled.value) {
      timeframes.add('5m');
    }

    if (this.config.marketScannerAutoEnter_Enabled.value || this.marketScannerModeEnabled) {
      timeframes.add('1m');
      timeframes.add('5m');
      timeframes.add('15m');
    }

    return Array.from(timeframes);
  }

  public isBackTesting(): boolean {
    return this.mode === BotRunMode.BACKTEST;
  }

  public async pause({ persist = true }: { persist?: boolean } = {}): Promise<void> {
    this.state = BotState.PAUSED;
    if (persist && !this.isBackTesting()) {
      await setBotPaused(true);
    }
    this.logger.info(`🤖 Bot ${this.id} is paused.`);
  }

  public async resume({ persist = true }: { persist?: boolean } = {}): Promise<void> {
    this.state = BotState.LOOKING_FOR_TRADES;
    if (persist && !this.isBackTesting()) {
      await setBotPaused(false);
    }
    if (!this.isBackTesting()) {
      this.marketScannerModeEnabled = true;
      await this.setupMarketScannerClient();
    }
    this.logger.info(`🤖 Bot ${this.id} is resumed and looking for trades.`);
  }

  // #################################################################
  // # Subscribe Events
  // #################################################################
  private async subscribeEvents() {
    await this.exchange.connect();
    await this.subscribeTradingSymbolEvents(this.config.assetSymbol);
    await this.subscribeOpenPositionEvents();
  }

  private async subscribeTradingSymbolEvents(symbol: string): Promise<void> {
    if (this.subscribedTradingSymbols.has(symbol)) {
      return;
    }
    this.subscribedTradingSymbols.add(symbol);

    return this.exchange.subscribeKlines(
      symbol,
      this.getSubscribedTimeframes(),
      async (_, klinesBuffer) => {
        if (!klinesBuffer) {
          return;
        }
        const newKline = klinesBuffer.getLast();

        if (!newKline) {
          return;
        }

        // #################################################################
        // # DEBUG ZONE TO SLOW MO BACKTESTS
        // #################################################################
        // if (newKline.timestamp === 1770548400000) {
        //   const exchange = this.exchange as FakeExchange;
        //   exchange.slowMotion(0.5);
        // }

        // Debug to show kline price in real time:
        //process.stdout.write(`\x1b[2K\x1b[1G${newKline.close}`);

        // Existing TA indicators are keyed to the configured asset symbol.
        if (newKline.pair === this.config.assetSymbol) {
          this.taManager.addKline(newKline);
        }

        const numPositionOpened = this.positionManager.getNumOpenedPositions();
        const isTradingTimeframeKline = newKline.timeframe === this.config.timeFrameToTrade;

        if (numPositionOpened > 0 && isTradingTimeframeKline) {
          await this.positionManager.recalculatePositions(newKline.pair);
        }

        // We don't care about entering new positions if we have reached max allowed
        // if (
        //   numPositionOpened < this.riskManager.getMaxPositionsRunning() &&
        //   newKline.pair === this.config.assetSymbol &&
        //   false === this.positionManager.hasOpenPositionForSymbol(newKline.pair) &&
        //   this.state === BotState.LOOKING_FOR_TRADES
        // ) {
        //   await this.strategyManager.executeEnterStrategies(klinesBuffer);
        // }

        // We only execute exit strategies if we have opened positions`
        if (numPositionOpened > 0 && isTradingTimeframeKline) {
          await this.strategyManager.executeExitStrategies(klinesBuffer);
          await this.riskManager.executeRiskStrategies(newKline);
          await Telegram.updatePositionMonitor();
        }
      }
    );
  }

  public async releaseClosedPositionMarketData(symbol: string): Promise<void> {
    if (this.isBackTesting()) {
      return;
    }

    const normalizedSymbol = normalizeSymbolString(symbol);
    if (!normalizedSymbol) {
      this.logger.warn(`Cannot release Nexus market data: invalid symbol ${symbol}`);
      return;
    }

    const normalizedConfigSymbol =
      normalizeSymbolString(this.config.assetSymbol) ?? this.config.assetSymbol;
    if (normalizedSymbol === normalizedConfigSymbol) {
      return;
    }

    if (this.positionManager.hasOpenPositionForSymbol(normalizedSymbol)) {
      return;
    }

    if (!this.subscribedTradingSymbols.has(normalizedSymbol)) {
      return;
    }

    try {
      await this.exchange.unsubscribeKlines(normalizedSymbol, this.getSubscribedTimeframes());
      this.subscribedTradingSymbols.delete(normalizedSymbol);
      this.logger.info(`Released Nexus market data subscription for ${normalizedSymbol}.`);
    } catch (err) {
      this.logger.error(`Failed to release Nexus market data for ${normalizedSymbol}: ${err}`);
    }
  }

  private async subscribeOpenPositionEvents(): Promise<void> {
    const positionSymbols = new Set<string>();

    for (const position of this.positionManager.getOpenPositions()) {
      const symbol = normalizeSymbolString(position.symbol);
      if (!symbol) {
        this.logger.warn(
          `Cannot subscribe open position market data: invalid symbol ${position.symbol}`
        );
        continue;
      }
      positionSymbols.add(symbol);
    }

    if (positionSymbols.size === 0) {
      return;
    }

    this.logger.info(
      `Subscribing Nexus market data for open positions: ${Array.from(positionSymbols).join(', ')}`
    );

    await Promise.all(
      Array.from(positionSymbols).map((symbol) => this.ensureSymbolMarketData(symbol))
    );
    await this.positionManager.recalculatePositions();
    await Telegram.updatePositionMonitor();
  }

  private async setupMarketScannerClient(): Promise<void> {
    if (this.isBackTesting()) {
      return;
    }

    if (this.scannerClient !== null) {
      return;
    }

    this.scannerClient = new NexusMarketScannerSocketClient();
    try {
      await this.scannerClient.connect();
    } catch (err) {
      this.logger.error(`Market scanner client could not be connected: ${err}`);
      this.scannerClient = null;
      throw err;
    }
    this.scannerSnapshotUnsubscribe = this.scannerClient.onSnapshot(() => {
      this.tryOpenMarketScannerPosition().catch((err) => {
        this.logger.error(err as Error);
      });
    });
  }

  private teardownMarketScannerClient(): void {
    if (this.scannerSnapshotUnsubscribe !== null) {
      this.scannerSnapshotUnsubscribe();
      this.scannerSnapshotUnsubscribe = null;
    }

    this.scannerClient?.disconnect();
    this.scannerClient = null;
  }

  private async tryOpenMarketScannerPosition(): Promise<void> {
    if (!this.marketScannerModeEnabled) {
      return;
    }

    if (this.scannerAutoEnterInProgress) {
      return;
    }

    if (this.state !== BotState.LOOKING_FOR_TRADES) {
      return;
    }

    const checkEveryMs = this.config.marketScannerAutoEnter_CheckEverySeconds.value * 1000;
    const now = Date.now();
    if (checkEveryMs > 0 && now - this.lastMarketScannerAutoEnterCheckAt < checkEveryMs) {
      return;
    }
    this.lastMarketScannerAutoEnterCheckAt = now;

    const openPositions = this.positionManager.getNumOpenedPositions();
    const maxPositions = this.riskManager.getMaxPositionsRunning();
    if (openPositions >= maxPositions) {
      return;
    }

    const snapshot = this.scannerClient?.getLatestSnapshot();
    if (!snapshot) {
      return;
    }

    const candidates = this.selectMarketScannerCandidates(snapshot.symbols);
    if (candidates.length === 0) {
      return;
    }

    this.scannerAutoEnterInProgress = true;
    try {
      for (const candidate of candidates) {
        if (this.state !== BotState.LOOKING_FOR_TRADES) {
          break;
        }

        const openPositions = this.positionManager.getNumOpenedPositions();
        const maxPositions = this.riskManager.getMaxPositionsRunning();
        if (openPositions >= maxPositions) {
          break;
        }

        await this.openMarketScannerPosition(candidate);
      }
    } finally {
      this.scannerAutoEnterInProgress = false;
    }
  }

  private selectMarketScannerCandidates(
    symbols: NexusMarketScannerSymbolStats[]
  ): NexusMarketScannerSymbolStats[] {
    const threshold = this.config.marketScannerAutoEnter_MinAbsPriceChange15mPct.value;

    return symbols
      .filter((symbol) => this.isMarketScannerCandidateEligible(symbol, threshold))
      .sort((left, right) => {
        const tradeCountDiff =
          this.getMarketScannerCandidateTradeCount(right) -
          this.getMarketScannerCandidateTradeCount(left);
        if (tradeCountDiff !== 0) {
          return tradeCountDiff;
        }

        const tradesPerSecondDiff =
          this.getMarketScannerCandidateTradesPerSecond(right) -
          this.getMarketScannerCandidateTradesPerSecond(left);
        if (tradesPerSecondDiff !== 0) {
          return tradesPerSecondDiff;
        }

        return (
          this.getMarketScannerCandidateScore(right) - this.getMarketScannerCandidateScore(left)
        );
      })
      .slice(0, MARKET_SCANNER_AUTO_ENTER_CANDIDATES_LIMIT);
  }

  private isMarketScannerCandidateEligible(
    symbol: NexusMarketScannerSymbolStats,
    threshold: number
  ): boolean {
    const normalizedSymbol = normalizeSymbolString(symbol.symbol);
    return (
      normalizedSymbol !== null &&
      this.getMarketScannerMaxAbsPriceChangePct(symbol) >= threshold &&
      !this.positionManager.hasOpenPositionForSymbol(normalizedSymbol) &&
      !this.positionManager.isAutoEnterOnCooldown(normalizedSymbol, Date.now())
    );
  }

  private async openMarketScannerPosition(candidate: NexusMarketScannerSymbolStats): Promise<void> {
    if (!this.marketScannerModeEnabled) {
      return;
    }

    const deltaDecision = await this.confirmMarketScannerDelta(candidate);
    if (!deltaDecision) {
      return;
    }

    const confirmedCandidate = deltaDecision.confirmedCandidate;
    const symbol = normalizeSymbolString(confirmedCandidate.symbol);
    if (!symbol) {
      return;
    }

    await this.ensureSymbolMarketData(symbol);

    const currentPrice = this.exchange.getCurrentPrice(symbol, this.config.timeFrameToTrade);
    if (currentPrice === null) {
      this.logger.warn(
        `Market scanner auto-enter skipped: no ${this.config.timeFrameToTrade} price for ${symbol}`
      );
      return;
    }

    const latestKline = this.exchange
      .getKlinesBuffer(symbol, this.config.timeFrameToTrade)
      ?.getLast();

    if (!latestKline) {
      return;
    }

    const strategyExecuted: EnterStrategyActionExecuted = {
      strategyName: 'MarketScannerAutoEnter',
      params: {
        scannerSymbol: confirmedCandidate.symbol,
        priceChange1mPct: this.getFiniteMarketScannerMetric(confirmedCandidate.priceChange1mPct),
        priceChange15mPct: confirmedCandidate.priceChange15mPct,
        priceChange5mPct: confirmedCandidate.priceChange5mPct,
        threshold: this.config.marketScannerAutoEnter_MinAbsPriceChange15mPct.value,
        volumeDelta: deltaDecision.volumeDelta,
        volumeDeltaImbalance: deltaDecision.volumeDeltaImbalance,
        recentVolumeDelta: deltaDecision.recentVolumeDelta,
        recentVolumeDeltaImbalance: deltaDecision.recentVolumeDeltaImbalance,
        deltaSource: deltaDecision.source,
        weightedPriceChangePct: deltaDecision.weightedPriceChangePct,
        maxAbsPriceChangePct: deltaDecision.maxAbsPriceChangePct,
        priceAlignmentScore: deltaDecision.priceAlignmentScore,
        tradesPerSecond: deltaDecision.tradesPerSecond,
        scannerScore: deltaDecision.totalScore,
      },
      action: deltaDecision.action,
      kline: latestKline,
      riskRewardRatio: this.config.marketScannerAutoEnter_RiskRewardRatio.value,
    };

    const margin = await this.riskManager.calculateOrderSize();
    await this.orderManager.openOrderMarket([strategyExecuted], margin, {
      orderType: this.config.marketScannerLimitOrders_Enabled.value
        ? ALXOrderType.LIMIT
        : ALXOrderType.MARKET,
      limitType: this.config.marketScannerLimitOrders_Enabled.value
        ? ALXOrderLimitType.POST_ONLY
        : undefined,
      limitOffsetRate: this.config.marketScannerLimitOrders_OffsetRate.value,
      takeProfitRiskRewardRatio:
        this.config.marketScannerLimitOrders_TakeProfitRiskRewardRatio.value,
    });
  }

  private async confirmMarketScannerDelta(
    candidate: NexusMarketScannerSymbolStats
  ): Promise<MarketScannerDeltaDecision | null> {
    const waitMs = this.config.marketScannerAutoEnter_DeltaConfirmationSeconds.value * 1000;
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    if (this.state !== BotState.LOOKING_FOR_TRADES) {
      return null;
    }

    if (!this.marketScannerModeEnabled) {
      return null;
    }

    const openPositions = this.positionManager.getNumOpenedPositions();
    const maxPositions = this.riskManager.getMaxPositionsRunning();
    if (openPositions >= maxPositions) {
      return null;
    }

    const threshold = this.config.marketScannerAutoEnter_MinAbsPriceChange15mPct.value;
    const snapshot = this.scannerClient?.getLatestSnapshot();
    const confirmedCandidate = snapshot?.symbols.find((symbol) => {
      return symbol.symbol === candidate.symbol;
    });

    if (
      !confirmedCandidate ||
      !this.isMarketScannerCandidateEligible(confirmedCandidate, threshold)
    ) {
      this.logger.debug(
        `Market scanner auto-enter skipped: ${candidate.symbol} was not confirmed after delta wait`
      );
      return null;
    }

    const decision = this.getMarketScannerDeltaDecision(candidate, confirmedCandidate);
    if (!decision) {
      this.logger.debug(
        `Market scanner auto-enter skipped: no clear volume delta for ${candidate.symbol}`
      );
    }

    return decision;
  }

  private getMarketScannerDeltaDecision(
    initialCandidate: NexusMarketScannerSymbolStats,
    confirmedCandidate: NexusMarketScannerSymbolStats
  ): MarketScannerDeltaDecision | null {
    const minImbalance = this.config.marketScannerAutoEnter_MinVolumeDeltaImbalance.value;
    const rollingVolumeDelta = this.getMarketScannerVolumeDelta(confirmedCandidate);
    const rollingVolumeImbalance = this.getMarketScannerVolumeImbalance(confirmedCandidate);
    const recentDelta = this.getRecentMarketScannerVolumeDelta(
      initialCandidate,
      confirmedCandidate
    );

    const selectedImbalance =
      recentDelta !== null && Math.abs(recentDelta.imbalance) >= minImbalance
        ? { source: 'recent' as const, delta: recentDelta.delta, imbalance: recentDelta.imbalance }
        : {
            source: 'rolling' as const,
            delta: rollingVolumeDelta,
            imbalance: rollingVolumeImbalance,
          };

    if (
      !Number.isFinite(selectedImbalance.delta) ||
      !Number.isFinite(selectedImbalance.imbalance) ||
      Math.abs(selectedImbalance.imbalance) < minImbalance ||
      selectedImbalance.delta === 0
    ) {
      return null;
    }

    const action =
      selectedImbalance.delta > 0
        ? EnterStrategyAction.ENTER_SHORT
        : EnterStrategyAction.ENTER_LONG;
    const weightedPriceChangePct = this.getMarketScannerWeightedPriceChangePct(confirmedCandidate);
    const maxAbsPriceChangePct = this.getMarketScannerMaxAbsPriceChangePct(confirmedCandidate);
    const priceAlignmentScore =
      action === EnterStrategyAction.ENTER_LONG ? weightedPriceChangePct : -weightedPriceChangePct;
    const tradesPerSecond = Number.isFinite(confirmedCandidate.tradesPerSecond)
      ? confirmedCandidate.tradesPerSecond
      : 0;
    const totalScore = this.getMarketScannerCandidateScore(confirmedCandidate, {
      imbalance: selectedImbalance.imbalance,
      priceAlignmentScore,
    });

    return {
      action,
      confirmedCandidate,
      volumeDelta: rollingVolumeDelta,
      volumeDeltaImbalance: rollingVolumeImbalance,
      recentVolumeDelta: recentDelta?.delta ?? null,
      recentVolumeDeltaImbalance: recentDelta?.imbalance ?? null,
      source: selectedImbalance.source,
      weightedPriceChangePct,
      maxAbsPriceChangePct,
      priceAlignmentScore,
      tradesPerSecond,
      totalScore,
    };
  }

  private getMarketScannerCandidateScore(
    candidate: NexusMarketScannerSymbolStats,
    overrides?: { imbalance?: number; priceAlignmentScore?: number }
  ): number {
    const imbalance = overrides?.imbalance ?? this.getMarketScannerVolumeImbalance(candidate);
    const weightedPriceChangePct = this.getMarketScannerWeightedPriceChangePct(candidate);
    const priceAlignmentScore = overrides?.priceAlignmentScore ?? Math.abs(weightedPriceChangePct);
    const maxAbsPriceChangePct = this.getMarketScannerMaxAbsPriceChangePct(candidate);
    const tradesPerSecond = this.getMarketScannerCandidateTradesPerSecond(candidate);

    return (
      Math.abs(imbalance) * 100 +
      Math.max(0, priceAlignmentScore) * 6 +
      maxAbsPriceChangePct * 4 +
      Math.log1p(tradesPerSecond) * 8
    );
  }

  private getMarketScannerCandidateTradeCount(candidate: NexusMarketScannerSymbolStats): number {
    return Number.isFinite(candidate.tradeCount) ? Math.max(0, candidate.tradeCount) : 0;
  }

  private getMarketScannerCandidateTradesPerSecond(
    candidate: NexusMarketScannerSymbolStats
  ): number {
    return Number.isFinite(candidate.tradesPerSecond) ? Math.max(0, candidate.tradesPerSecond) : 0;
  }

  private getMarketScannerWeightedPriceChangePct(candidate: NexusMarketScannerSymbolStats): number {
    const weightedMetrics = [
      {
        value: this.getFiniteMarketScannerMetric(candidate.priceChange1mPct),
        weight: MARKET_SCANNER_PRICE_CHANGE_WEIGHTS.priceChange1mPct,
      },
      {
        value: this.getFiniteMarketScannerMetric(candidate.priceChange5mPct),
        weight: MARKET_SCANNER_PRICE_CHANGE_WEIGHTS.priceChange5mPct,
      },
      {
        value: this.getFiniteMarketScannerMetric(candidate.priceChange15mPct),
        weight: MARKET_SCANNER_PRICE_CHANGE_WEIGHTS.priceChange15mPct,
      },
    ].filter((metric) => Number.isFinite(metric.value));

    if (weightedMetrics.length === 0) {
      return 0;
    }

    const totalWeight = weightedMetrics.reduce((sum, metric) => sum + metric.weight, 0);
    if (totalWeight <= 0) {
      return 0;
    }

    return (
      weightedMetrics.reduce((sum, metric) => sum + metric.value * metric.weight, 0) / totalWeight
    );
  }

  private getMarketScannerMaxAbsPriceChangePct(candidate: NexusMarketScannerSymbolStats): number {
    return Math.max(
      Math.abs(this.getFiniteMarketScannerMetric(candidate.priceChange1mPct)),
      Math.abs(this.getFiniteMarketScannerMetric(candidate.priceChange5mPct)),
      Math.abs(this.getFiniteMarketScannerMetric(candidate.priceChange15mPct))
    );
  }

  private getFiniteMarketScannerMetric(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private getRecentMarketScannerVolumeDelta(
    initialCandidate: NexusMarketScannerSymbolStats,
    confirmedCandidate: NexusMarketScannerSymbolStats
  ): { delta: number; imbalance: number } | null {
    const buyVolumeDelta = confirmedCandidate.buyVolume - initialCandidate.buyVolume;
    const sellVolumeDelta = confirmedCandidate.sellVolume - initialCandidate.sellVolume;

    if (buyVolumeDelta < 0 || sellVolumeDelta < 0) {
      return null;
    }

    const totalVolumeDelta = buyVolumeDelta + sellVolumeDelta;
    if (totalVolumeDelta <= 0) {
      return null;
    }

    const delta = buyVolumeDelta - sellVolumeDelta;
    return {
      delta,
      imbalance: delta / totalVolumeDelta,
    };
  }

  private getMarketScannerVolumeDelta(candidate: NexusMarketScannerSymbolStats): number {
    return candidate.volumeDelta ?? candidate.buyVolume - candidate.sellVolume;
  }

  private getMarketScannerVolumeImbalance(candidate: NexusMarketScannerSymbolStats): number {
    if (candidate.volumeDeltaImbalance !== undefined) {
      return candidate.volumeDeltaImbalance;
    }

    if (candidate.totalVolume <= 0) {
      return 0;
    }

    return this.getMarketScannerVolumeDelta(candidate) / candidate.totalVolume;
  }

  private bootstrapSymbolKlineFromMarketScanner(symbol: string): void {
    const scannerSymbol = this.getMarketScannerSymbolStats(symbol);
    if (!scannerSymbol) {
      return;
    }

    const timeframe = this.config.timeFrameToTrade;
    const price = scannerSymbol.lastPrice;
    if (!Number.isFinite(price) || price <= 0) {
      return;
    }

    const timeframeMs = ALXTimeFramesMsMap[timeframe];
    const timestamp = Math.floor(scannerSymbol.timestamp / timeframeMs) * timeframeMs;
    const syntheticKline: ALXKline = {
      type: 'delta',
      pair: symbol,
      timeframe,
      timestamp,
      open: price,
      high: price,
      low: price,
      close: price,
      buyCost: 0,
      sellCost: 0,
      buyVolume: 0,
      sellVolume: 0,
      liqBuyCost: 0,
      liqSellCost: 0,
      liqBuyVolume: 0,
      liqSellVolume: 0,
      tradeCount: 0,
      liqCount: 0,
    };

    this.exchange.addKlinesToBuffer(symbol, timeframe, [syntheticKline]);
    this.logger.info(
      `Bootstrapped ${timeframe} kline buffer for ${symbol} from market scanner snapshot while Nexus history catches up.`
    );
  }

  private getMarketScannerSymbolStats(symbol: string): NexusMarketScannerSymbolStats | null {
    const snapshot = this.scannerClient?.getLatestSnapshot();
    if (!snapshot) {
      return null;
    }

    return (
      snapshot.symbols.find((candidate) => normalizeSymbolString(candidate.symbol) === symbol) ??
      null
    );
  }

  private async ensureSymbolMarketData(symbol: string): Promise<void> {
    if (!this.exchange.getKlinesBuffer(symbol, this.config.timeFrameToTrade)?.getLast()) {
      await this.exchange.warmUpKlinesBuffer(
        symbol,
        this.getSubscribedTimeframes(),
        config.defaults.buffer.size
      );
    }

    await this.subscribeTradingSymbolEvents(symbol);
  }

  public async runConfigOptimizer() {
    if (this.isBackTesting()) {
      return;
    }
    if (this.state === BotState.OPTIMIZING) {
      this.logger.info(`🤖 Config Optimizer is already running, skipping this run.`);
      return;
    }

    const numPositionOpened = this.positionManager.getNumOpenedPositions();

    // We only can run the optimizer if there are no opened positions
    if (numPositionOpened > 0) {
      return;
    }

    this.secondsSinceLastOptimization = 0;
    this.state = BotState.OPTIMIZING;
    const { maxCores } = getAvailableCpuCores();
    const startTimestampMs =
      Date.now() - this.config.configOptimizerLoopBackHours.value * 3600 * 1000;
    const endTimestampMs = Date.now();
    const configOptimizer = new ConfigOptimizer({
      initialBalance: this.exchange.balanceManager.getBalanceSnapshot().total,
      maxWorkers: maxCores,
      botConfig: this.config,
      mode: 'genetic',
      walkForwardFolds: this.config.configOptimizerGenetic?.params.walkForwardFolds ?? 0,
      silent: true,
      startTimestampMs,
      endTimestampMs,
    });
    const traceStart = Date.now();
    const bestConfigs = await configOptimizer.runAndGetBestResult();
    const best = bestConfigs?.bestFitnessResult;
    if (best) {
      this.logger.info(`🤖 Setting new optimized config found! 🚀`);
      this.config.setSerializedConfig(best.config);
      this.config.saveToFile(config.general.optimizedBotConfigFilePath);
      this.logger.info(`✅ Optimized config saved to ${config.general.optimizedBotConfigFilePath}`);
      let msg = '⚙️ NEW OPTIMIZED CONFIG: ' + os.EOL;
      msg += `🏋️ FTN: ${ansis.yellow((best.fitness ?? 0).toFixed(3))}` + os.EOL;
      msg += `💵 PNL: ${formatMoney(best.pnl)}` + os.EOL;
      msg += `💵 P10(PNL): ${formatMoney(best.p10Pnl)})` + os.EOL;
      msg += `📈 Sharpe: ${ansis.yellow(formatPerformanceMetric(best.sharpeRatio))}` + os.EOL;
      msg +=
        `⚖️ Profit Factor: ${ansis.yellow(formatPerformanceMetric(best.profitFactor))}` + os.EOL;
      msg +=
        `🏆 WR: ${ansis.yellow(`${best.winRate.toFixed(2)}%`)} (NumPos: ${ansis.cyan(best.numPositions.toFixed(0))})` +
        os.EOL;
      msg += `🕰️ P50 Hold: ${formatDurationMs(best.p50PositionDurationMs)}` + os.EOL;
      msg += `📉 P95 MAE: ${best.p95MAE.toFixed(2)}%` + os.EOL;
      this.logger.info(msg);
      const traceEnd = Date.now();
      const optimizationLog = `⏱️  Optimization took ${formatDurationMs(traceEnd - traceStart)} using ${maxCores} CPU cores.`;
      Telegram.sendMessage(msg + os.EOL + optimizationLog);
      this.logger.info(optimizationLog);
    } else {
      const msg = `🤖 Config Optimizer did not find a better config than the current one.`;
      this.logger.info(msg);
      Telegram.sendMessage(msg);
    }
    this.state = (await getBotPaused()) ? BotState.PAUSED : BotState.LOOKING_FOR_TRADES;
  }

  private async runKlinesDownloader() {
    // Always take double the loop back hours to have enough data
    const startDateMs =
      Date.now() - this.config.configOptimizerLoopBackHours.value * 3600 * 1000 * 2;
    const endDateMs = Date.now();
    const startDate = formatDateFromMs(startDateMs);
    const endDate = formatDateFromMs(endDateMs);
    await downloadHistoricalData(startDate, endDate);
  }

  private async setupConfigOptimizerScheduler() {
    if (config.configOptimizer.runEverySeconds <= 0) {
      return;
    }

    setInterval(async () => {
      this.secondsSinceLastOptimization += 1;
      if (
        this.secondsSinceLastOptimization >= config.configOptimizer.runEverySeconds &&
        this.state !== BotState.OPTIMIZING &&
        this.state !== BotState.INITIALIZING &&
        this.state !== BotState.PAUSED &&
        this.positionManager.getNumOpenedPositions() === 0
      ) {
        const msg = `🤖 Running Config Optimizer (Scheduler triggered at ${new Date().toISOString()})`;
        this.logger.info(msg);
        await this.runConfigOptimizer();
      }
    }, 1000);
  }
}
