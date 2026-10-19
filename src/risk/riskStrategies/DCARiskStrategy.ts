import type { SioBot } from '@/siobot/SioBot';
import { type ALXPosition } from '@/domain/ALXPosition';
import { formatMoney } from '@/utils/money';
import { Telegram } from '@/comms/Telegram';
import type { ALXKline } from '@/domain/ALXKline';
import {
  RiskStrategyAction,
  type RiskStrategy,
  type RiskStrategyActionExecuted,
} from '../riskStrategies.types';
import { RiskStrategyBase } from '../RiskStrategyBase';
import { capOrderSizeUSDT } from '../orderSize';

const DCA_TRIGGER_GAP_MS = 15 * 60 * 1000; // 15 minutes between DCA triggers on the same position

export class DCARiskStrategy extends RiskStrategyBase implements RiskStrategy {
  constructor(bot: SioBot) {
    super(bot);
  }

  /**
   * Get the current DCA level for a symbol (0 = no position, 1 = initial, 2+ = DCA'd)
   */
  public getDCALevel(position: ALXPosition): number {
    return (
      position.riskStrategiesExecuted?.filter((rs) => rs.action === RiskStrategyAction.DCA)
        .length ?? 0
    ); // +1 for the initial position
  }

  private getLastExecutedDCATimestamp(position: ALXPosition): number | null {
    const dcaStrategies = position.riskStrategiesExecuted?.filter(
      (rs) => rs.action === RiskStrategyAction.DCA
    );
    if (!dcaStrategies || dcaStrategies.length === 0) {
      return null;
    }
    return dcaStrategies[dcaStrategies.length - 1]?.executionTimestamp ?? null;
  }

  /**
   * Check if a position should trigger DCA based on its loss percentage
   */
  public shouldTriggerDCA(position: ALXPosition, kline: ALXKline): boolean {
    const currentLevel = this.getDCALevel(position);
    const maxTimes = this.bot.config.dcaRiskStrategy_MaxTimes.value;

    // Already at max DCA times
    if (currentLevel >= maxTimes) return false;

    // Already triggered recently
    const lastTriggeredDCATimestamp = this.getLastExecutedDCATimestamp(position);
    if (lastTriggeredDCATimestamp) {
      const timeSinceLastTrigger = kline.timestamp - lastTriggeredDCATimestamp;
      if (timeSinceLastTrigger < DCA_TRIGGER_GAP_MS) {
        return false;
      }
    }

    // Calculate loss percentage relative to margin
    const lossPercent = (position.realizedPnl / position.margin) * 100;
    const threshold = this.bot.config.dcaRiskStrategy_DropRateThreshold.value; // e.g., -10

    return lossPercent <= threshold;
  }

  public calculateDCAOrderSize(dcaLevel: number): number {
    const minOrderSizeRate = this.bot.config.riskMinOrderSizeRate.value;
    const dcaMaxTimes = this.bot.config.dcaRiskStrategy_MaxTimes.value;
    const maxConcurrentPositions = this.bot.config.riskMaxConcurrentPositions.value;
    const dcaMultiplier = this.bot.config.dcaRiskStrategy_SizeMultiplier.value;
    const totalBalance = this.bot.exchange.balanceManager.getTotalBalance();

    // Split baseMargin evenly across max concurrent positions
    const marginPerPosition = totalBalance / maxConcurrentPositions;
    // Apply minOrderSizeRate to limit the usable capital per position
    const totalCapitalPerPosition = marginPerPosition * minOrderSizeRate;

    // Calculate the sum of the geometric series: 1 + r + r^2 + ... + r^n where n = dcaMaxTimes
    // This represents all entries: initial (level 0) + DCA levels (1 to dcaMaxTimes)
    const totalEntries = dcaMaxTimes + 1;
    let seriesSum: number;

    if (dcaMultiplier === 1) {
      seriesSum = totalEntries;
    } else {
      seriesSum = (1 - Math.pow(dcaMultiplier, totalEntries)) / (1 - dcaMultiplier);
    }

    const orderSize = (totalCapitalPerPosition * Math.pow(dcaMultiplier, dcaLevel)) / seriesSum;

    if (orderSize < 1) {
      throw new Error(
        `❌ DCA order size ${orderSize.toFixed(2)} is too small. ` +
          `Max concurrent positions: ${maxConcurrentPositions}, ` +
          `Min order size rate: ${minOrderSizeRate}, ` +
          `DCA level: ${dcaLevel}/${dcaMaxTimes}. ` +
          `DCA Series multiplier: ${dcaMultiplier}. ` +
          `Adjust parameters or ensure sufficient balance.`
      );
    }

    const cappedOrderSize = capOrderSizeUSDT(orderSize, this.bot.config);
    if (cappedOrderSize < orderSize) {
      this.logger.info(
        `[RiskManager] Capping DCA order size from ${orderSize.toFixed(2)} to ${cappedOrderSize.toFixed(2)} USDT.`
      );
    }

    return Math.floor(cappedOrderSize);
  }

  /**
   * Evaluate and execute DCA for all open positions
   * Called from SioBot after position recalculation
   */
  public async execute(kline: ALXKline): Promise<void> {
    const openPositions = this.bot.positionManager.getOpenPositions();

    for (const position of openPositions) {
      if (position.symbol !== kline.pair) {
        continue;
      }

      if (this.shouldTriggerDCA(position, kline)) {
        await this.executeDCA(position, kline);
      }
    }
  }

  /**
   * Execute a DCA entry for a position
   */
  private async executeDCA(position: ALXPosition, kline: ALXKline): Promise<void> {
    const currentLevel = this.getDCALevel(position);
    const nextLevel = currentLevel + 1;
    const margin = this.calculateDCAOrderSize(nextLevel);

    const availableBalance = this.bot.exchange.balanceManager.getAvailableBalance();
    if (margin > availableBalance) {
      this.logger.warn(
        `[RiskManager] DCA skipped - insufficient balance. Need: ${formatMoney(margin)}, Available: ${formatMoney(availableBalance)}`
      );
      return;
    }

    const lossPercent = (position.realizedPnl / position.margin) * 100;

    const riskStrategy: RiskStrategyActionExecuted = {
      strategyName: `DCA_Level_${nextLevel}`,
      params: { dcaLevel: nextLevel, triggerLoss: lossPercent.toFixed(2) },
      action: RiskStrategyAction.DCA,
      executionTimestamp: kline.timestamp,
      kline,
    };

    const msg = `[DCA] Triggering level ${nextLevel} for ${position.symbol} (loss: ${lossPercent.toFixed(2)}%, margin: ${formatMoney(margin)})`;
    this.logger.info(msg);
    if (!this.bot.isBackTesting()) {
      Telegram.sendMessage(msg);
    }

    await this.bot.orderManager.openOrderMarketForRiskManagement([riskStrategy], position, margin);
  }
}
