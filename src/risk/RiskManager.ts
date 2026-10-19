import type { SioBot } from '@/siobot/SioBot';
import { getWeekDayFromTimestampMs, getWeekDaysEnabled } from '@/utils/date';
import { logger, silentLogger } from '@/utils/logger';
import type { RiskStrategy } from './riskStrategies.types';
import { DCARiskStrategy } from './riskStrategies/DCARiskStrategy';
import type { ALXKline } from '@/domain/ALXKline';
import { TrailingStopLossRiskStrategy } from './riskStrategies/TrailingStopLossRiskStrategy';
import { BreakoutStopLossRiskStrategy } from './riskStrategies/BreakoutStopLossRiskStrategy';
import { capOrderSizeUSDT } from './orderSize';

export class RiskManager {
  private bot: SioBot;
  private logger: typeof logger = logger;

  private riskStrategies: RiskStrategy[] = [];

  constructor(bot: SioBot) {
    this.bot = bot;
    if (this.bot.isBackTesting()) {
      this.logger = silentLogger as typeof logger; // silentLogger as typeof logger;
    }
    this._registerRiskStrategies();
  }

  /**
   * Determine if the bot is allowed to trade at the current time
   * based on risk management settings.
   * Note: The bot can still close positions even if trading is disabled.
   *       but it cannot open new order -> positions.
   */
  public canTrade(): boolean {
    // #################################################################
    // # Position reached control
    // #################################################################
    const maxPositions = this.getMaxPositionsRunning();
    const currentOpenPositions = this.bot.positionManager.getNumOpenedPositions();
    const numPositionMaxReached = currentOpenPositions >= maxPositions;

    if (numPositionMaxReached) {
      this.logger.warn(
        `[RiskManager] ❌ Max concurrent positions reached ` +
          `(${currentOpenPositions}/${maxPositions}). Cannot open new orders.`
      );
      return false;
    }

    const lastKline = this.bot.exchange
      .getKlinesBuffer(this.bot.config.assetSymbol, this.bot.config.timeFrameToTrade)
      ?.getLast();
    if (!lastKline) {
      this.logger.warn(
        `[RiskManager] ❌ No klines available for ${this.bot.config.assetSymbol} ` +
          `on timeframe ${this.bot.config.timeFrameToTrade}. Cannot determine trading day.`
      );
      return false;
    }
    const currentWeekDay = getWeekDayFromTimestampMs(lastKline.timestamp);
    const tradeDaysBitmask = this.bot.config.tradeOnDaysBitmask.value;
    const enabledWeekDays = getWeekDaysEnabled(tradeDaysBitmask);
    const isTradingDay = enabledWeekDays[currentWeekDay];

    if (!isTradingDay) {
      this.logger.info(
        `[RiskManager] ❌ Today is ${currentWeekDay}. Trading is disabled on this day as per configuration.`
      );
      return false;
    }

    return true;
  }

  public calculateLeverage(): number {
    return this.bot.config.riskLeverage.value;
  }

  private getDCARiskStrategyInstance(): DCARiskStrategy | null {
    const strategy = this.riskStrategies.find((s) => s instanceof DCARiskStrategy) as
      | DCARiskStrategy
      | undefined;
    return strategy || null;
  }

  public async calculateOrderSize(): Promise<number> {
    if (this.bot.config.dcaRiskStrategy_Enabled.value) {
      const DCARiskStrategyInstance = this.getDCARiskStrategyInstance();
      if (!DCARiskStrategyInstance) {
        throw new Error('DCA Risk Strategy is not registered in RiskManager');
      }
      return DCARiskStrategyInstance.calculateDCAOrderSize(0);
    }

    const minOrderSizeRate = this.bot.config.riskMinOrderSizeRate.value;

    // Use available balance (total - locked) and partition across remaining position slots
    const availableBalance = this.bot.exchange.balanceManager.getAvailableBalance();
    const maxConcurrentPositions = this.bot.config.riskMaxConcurrentPositions.value;
    const numOpenPositions = this.bot.positionManager.getNumOpenedPositions();

    // Partition available balance across remaining position slots
    const remainingPositionSlots = maxConcurrentPositions - numOpenPositions;
    const capitalPerPosition = availableBalance / Math.max(1, remainingPositionSlots);

    const orderSize = capitalPerPosition * minOrderSizeRate - 1; // Subtract 1 USDT as buffer
    if (orderSize < 1) {
      throw new Error(
        `❌ Order size ${orderSize.toFixed(2)} is too small. ` +
          `Available: ${availableBalance.toFixed(2)}, ` +
          `Open positions: ${numOpenPositions}/${maxConcurrentPositions}. ` +
          `Adjust MaxOrderSizeRate or ensure sufficient balance.`
      );
    }
    const cappedOrderSize = capOrderSizeUSDT(orderSize, this.bot.config);
    if (cappedOrderSize < orderSize) {
      this.logger.info(
        `[RiskManager] Capping order size from ${orderSize.toFixed(2)} to ${cappedOrderSize.toFixed(2)} USDT.`
      );
    }

    return cappedOrderSize;
  }

  public getMaxPositionsRunning(): number {
    return this.bot.config.riskMaxConcurrentPositions.value;
  }

  private _registerRiskStrategies(): void {
    if (this.bot.config.dcaRiskStrategy_Enabled.value) {
      this.logger.info('⚙️ RiskStrategyManager: Registering DCA Risk Strategy');
      this.riskStrategies.push(new DCARiskStrategy(this.bot));
    }
    if (this.bot.config.trailingStopLossRiskStrategy_Enabled.value) {
      this.logger.info('⚙️ RiskStrategyManager: Registering Trailing Stop Loss Risk Strategy');
      this.riskStrategies.push(new TrailingStopLossRiskStrategy(this.bot));
    }
    if (this.bot.config.breakoutStopLossRiskStrategy_Enabled.value) {
      this.logger.info('⚙️ RiskStrategyManager: Registering Breakout Stop Loss Risk Strategy');
      this.riskStrategies.push(new BreakoutStopLossRiskStrategy(this.bot));
    }
  }

  public async executeRiskStrategies(kline: ALXKline): Promise<void> {
    // Execute all risk strategies
    for (const strategy of this.riskStrategies) {
      await strategy.execute(kline);
    }
  }
}
