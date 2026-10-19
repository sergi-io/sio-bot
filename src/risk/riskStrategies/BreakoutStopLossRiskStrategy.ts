import type { SioBot } from '@/siobot/SioBot';
import type { ALXKline } from '@/domain/ALXKline';
import {
  RiskStrategyAction,
  type RiskStrategy,
  type RiskStrategyActionExecuted,
} from '../riskStrategies.types';
import { RiskStrategyBase } from '../RiskStrategyBase';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import type { HighLowsBufferedIndicator } from '@/ta/indicators/SioHighLows';

/**
 * Breakout Stop Loss Risk Strategy:
 * - For each open position, if no breakout stop loss has been set, calculate a new stop loss level based on the recent
 * high/low breakout levels and a configured breakout buffer rate.
 * - For long positions, the stop loss is set below the lowest low; for short positions, it is set above the highest high.
 * - Only set the stop loss once per position to avoid overwriting the initial breakout level with subsequent signals.
 * - Record the action of setting the breakout stop loss in the position's risk strategy execution history.
 * This strategy helps to protect against breakout failures by placing stops at key technical levels.
 * - Note: This strategy does not execute actual stop loss orders on the exchange. It only calculates and records the
 * stop loss levels. The actual execution of stop loss orders would need to be implemented separately, potentially in a position management component that monitors these calculated levels.
 * The logic for executing stop loss orders based on the calculated breakout stop loss is performed by an ExitStrategy
 */
export class BreakoutStopLossRiskStrategy extends RiskStrategyBase implements RiskStrategy {
  private highLowsTA: HighLowsBufferedIndicator;

  constructor(bot: SioBot) {
    super(bot);
    this.highLowsTA = this.bot.taManager.getHighLows(
      this.bot.config.breakoutStopLossRiskStrategy_LoopbackPeriod.value,
      false
    );
  }

  public async execute(kline: ALXKline): Promise<void> {
    const openPositions = this.bot.positionManager.getOpenPositions();
    for (const position of openPositions) {
      // If a BreakoutStopLoss has already been executed for this position, we skip it to avoid overwriting the existing stop loss with a new one. This ensures that we only set the initial breakout stop loss and don't keep moving it with every new breakout signal.
      const existingBreakoutStopLoss = this._getBreakoutStopLossForPosition(position);
      if (existingBreakoutStopLoss) {
        continue;
      }

      const stopLossPrice = this._calculateBreakoutStopLoss(position);
      if (!stopLossPrice) {
        continue;
      }

      // Record the trailing stop loss action
      const actionExecuted: RiskStrategyActionExecuted = {
        strategyName: 'BreakoutStopLossRiskStrategy',
        kline,
        action: RiskStrategyAction.BREAKOUT_STOP_LOSS,
        executionTimestamp: Date.now(),
        params: {
          stopLossPrice,
        },
      };
      position.riskStrategiesExecuted = position.riskStrategiesExecuted || [];
      position.riskStrategiesExecuted.push(actionExecuted);
    }
  }

  private _calculateBreakoutStopLoss(position: ALXPosition): number | undefined {
    const lastHighLows = this.highLowsTA.buffer.getLast();
    if (!lastHighLows) {
      return undefined;
    }

    if (position.side === ALXPositionSide.LONG) {
      const supportLevel = lastHighLows.ll;
      if (!supportLevel) {
        return undefined;
      }
      const breakoutBufferRate =
        this.bot.config.breakoutStopLossRiskStrategy_BreakoutBufferRate.value;
      const stopLossPrice = supportLevel * (1 - breakoutBufferRate);
      return stopLossPrice;
    } else if (position.side === ALXPositionSide.SHORT) {
      const resistanceLevel = lastHighLows.hh;
      if (!resistanceLevel) {
        return undefined;
      }
      const breakoutBufferRate =
        this.bot.config.breakoutStopLossRiskStrategy_BreakoutBufferRate.value;
      const stopLossPrice = resistanceLevel * (1 + breakoutBufferRate);
      return stopLossPrice;
    }

    return undefined;
  }

  private _getBreakoutStopLossForPosition(
    position: ALXPosition
  ): RiskStrategyActionExecuted | undefined {
    const breakoutStopLossStrategies = position.riskStrategiesExecuted?.filter(
      (rs) => rs.action === RiskStrategyAction.BREAKOUT_STOP_LOSS
    );
    if (!breakoutStopLossStrategies || breakoutStopLossStrategies.length === 0) {
      return undefined;
    }
    const breakoutStopLoss = breakoutStopLossStrategies[breakoutStopLossStrategies.length - 1];
    return breakoutStopLoss;
  }
}
