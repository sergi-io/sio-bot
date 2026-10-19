import {
  ExitStrategyAction,
  type ExitStrategyActionExecuted,
  type ExitStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import type { ALXKline } from '@/domain/ALXKline';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { EventReactStrategy } from '@/siobot/BotConfig';
import { RiskStrategyAction } from '@/risk/riskStrategies.types';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

/**
 * Exit strategy that triggers an exit when the price breaks below the support level for long positions
 * or above the resistance level for short positions, based on the HighLows indicator.
 * breakoutBufferRate is used to add a buffer to the support/resistance levels to avoid false breakouts. For example, if breakoutBufferRate is 0.005 (0.5%), the strategy will trigger an exit when the price breaks below support * (1 - 0.005) for long positions, or above resistance * (1 + 0.005) for short positions.
 */
export class BreakoutStopLossExitStrategy implements ExitStrategy {
  public name: string = 'BreakoutStopLossExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.DELTA_KLINE;
  public bot: SioBot;

  constructor(bot: SioBot) {
    this.bot = bot;
  }

  public execute(
    klinesBuffer: RollingWindowBuffer<ALXKline>,
    position: ALXPosition
  ): ExitStrategyActionExecuted | false {
    // Find for BreakoutStopLossRiskStrategy executed for this position to get the stop loss price
    const breakoutStopLossStrategyExecuted = position.riskStrategiesExecuted?.find(
      (execution) => execution.action === RiskStrategyAction.BREAKOUT_STOP_LOSS
    );

    if (!breakoutStopLossStrategyExecuted) {
      return false;
    }

    const stopLossPrice = breakoutStopLossStrategyExecuted.params.stopLossPrice;
    const currentKline = klinesBuffer.getLast();
    if (!currentKline) {
      return false;
    }

    if (!this.bot.isBackTesting()) {
      logger.info(
        `[${this.name}] Current: ${currentKline.close} -> StopLoss: ${breakoutStopLossStrategyExecuted.params.stopLossPrice.toFixed(2)}`
      );
    }

    if (
      (position.side === ALXPositionSide.LONG && currentKline.close > stopLossPrice) ||
      (position.side === ALXPositionSide.SHORT && currentKline.close < stopLossPrice)
    ) {
      return false;
    }

    return {
      strategyName: this.name,
      params: {
        stopLossPrice,
      },
      action: ExitStrategyAction.EXIT_CLOSE,
      kline: currentKline!,
    };
  }
}
