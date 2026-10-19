import type { SioBot } from '@/siobot/SioBot';
import type { ALXKline } from '@/domain/ALXKline';
import {
  RiskStrategyAction,
  type RiskStrategy,
  type RiskStrategyActionExecuted,
} from '../riskStrategies.types';
import { RiskStrategyBase } from '../RiskStrategyBase';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { formatMoney } from '@/utils/money';

/**
 * Trailing Stop Loss Risk Strategy:
 * - For each open position, if it is in profit, calculate a new stop loss level based on the entry price and a configured
 * trailing offset rate.
 * - Only update the stop loss if the new level is more favorable than the previous one (higher for long positions, lower
 * for short positions).
 * - Record the action of updating the stop loss in the position's risk strategy execution history.
 * This strategy helps to lock in profits as the price moves favorably while allowing for some market fluctuations.
 * - Note: This strategy does not execute actual stop loss orders on the exchange. It only calculates and records the
 * new stop loss levels. The actual execution of stop loss orders would need to be implemented separately, potentially in a position management component that monitors these calculated levels.
 * The logic for executing stop loss orders based on the calculated trailing stop loss is performed by an ExitStrategy
 */
export class TrailingStopLossRiskStrategy extends RiskStrategyBase implements RiskStrategy {
  constructor(bot: SioBot) {
    super(bot);
  }

  public async execute(kline: ALXKline): Promise<void> {
    const openPositions = this.bot.positionManager.getOpenPositions();
    for (const position of openPositions) {
      if (position.symbol !== kline.pair) {
        continue;
      }

      if (position.realizedPnl <= 0) {
        continue;
      }

      const newStopLossPrice = this._calculateTrailingStopLossPrice(position, kline);

      const previousTrailingStopLoss = this.getPreviousExecutedTrailingStopLoss(position);

      // Only update if new stop loss is higher than previous (for long positions) or lower (for short positions)
      if (
        (position.side === ALXPositionSide.LONG &&
          (!previousTrailingStopLoss ||
            newStopLossPrice > previousTrailingStopLoss.params.stopLossPrice!)) ||
        (position.side === ALXPositionSide.SHORT &&
          (!previousTrailingStopLoss ||
            newStopLossPrice < previousTrailingStopLoss.params.stopLossPrice!))
      ) {
        const oldTrailingPnl = this.bot.positionManager.getPositionPnlByClosePrice(
          position,
          previousTrailingStopLoss
            ? previousTrailingStopLoss.params.stopLossPrice
            : position.entryPrice
        );
        const trailingPnl = this.bot.positionManager.getPositionPnlByClosePrice(
          position,
          newStopLossPrice
        );

        this.logger.info(
          `🔄 Trailing Stop Loss: Updating stop loss ${position.symbol} ` +
            `${formatMoney(oldTrailingPnl, { decimalsPlaces: 2 })} -> ${formatMoney(trailingPnl, {
              decimalsPlaces: 2,
            })}.`
        );

        if (!previousTrailingStopLoss) {
          // Record the trailing stop loss action
          const actionExecuted: RiskStrategyActionExecuted = {
            strategyName: 'TrailingStopLossRiskStrategy',
            kline,
            action: RiskStrategyAction.TRAILING_STOP_LOSS,
            executionTimestamp: Date.now(),
            params: {
              stopLossPrice: newStopLossPrice,
              trailingPnl,
            },
          };
          position.riskStrategiesExecuted = position.riskStrategiesExecuted || [];
          position.riskStrategiesExecuted.push(actionExecuted);
        } else {
          // Update the existing trailing stop loss action in the position's risk strategy execution history
          previousTrailingStopLoss.params.stopLossPrice = newStopLossPrice;
          previousTrailingStopLoss.params.trailingPnl = trailingPnl;
          previousTrailingStopLoss.kline = kline;
          previousTrailingStopLoss.executionTimestamp = Date.now();
        }
      }
    }
  }

  private _calculateTrailingStopLossPrice(position: ALXPosition, kline: ALXKline): number {
    const trailingOffsetRate =
      this.bot.config.trailingStopLossRiskStrategy_TrailingOffsetRate.value;
    let newStopLoss = 0;
    if (position.side === ALXPositionSide.LONG) {
      newStopLoss = kline.close * (1 - trailingOffsetRate);
    } else if (position.side === ALXPositionSide.SHORT) {
      newStopLoss = kline.close * (1 + trailingOffsetRate);
    }
    return newStopLoss;
  }

  private getPreviousExecutedTrailingStopLoss(
    position: ALXPosition
  ): RiskStrategyActionExecuted | undefined {
    const trailingStopLossStrategies = position.riskStrategiesExecuted?.filter(
      (rs) => rs.action === RiskStrategyAction.TRAILING_STOP_LOSS
    );
    if (!trailingStopLossStrategies || trailingStopLossStrategies.length === 0) {
      return undefined;
    }
    const lastTrailingStopLoss = trailingStopLossStrategies[trailingStopLossStrategies.length - 1];
    return lastTrailingStopLoss;
  }
}
