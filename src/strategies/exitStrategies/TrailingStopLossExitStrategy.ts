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
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

export class TrailingStopLossExitStrategy implements ExitStrategy {
  public name: string = 'TrailingStopLossExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.DELTA_KLINE;
  public bot: SioBot;

  constructor(bot: SioBot) {
    this.bot = bot;
  }

  public execute(
    klinesBuffer: RollingWindowBuffer<ALXKline>,
    position: ALXPosition
  ): ExitStrategyActionExecuted | false {
    const trailingStopRiskStrategies = position.riskStrategiesExecuted?.filter(
      (rs) => rs.action === RiskStrategyAction.TRAILING_STOP_LOSS
    );

    if (!trailingStopRiskStrategies || trailingStopRiskStrategies.length === 0) {
      return false; // No trailing stop loss applied, so this exit strategy is not applicable
    }

    const lastTrailingStopLoss = trailingStopRiskStrategies[trailingStopRiskStrategies.length - 1];
    const trailingStopLossTriggerPrice = lastTrailingStopLoss?.params.stopLossPrice ?? 0;

    if (!trailingStopLossTriggerPrice || trailingStopLossTriggerPrice <= 0) {
      return false; // Invalid trailing stop loss trigger price, cannot apply this exit strategy
    }

    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      return false;
    }

    const triggerPrice = this.getTriggerPrice(position, currentKline);

    if (
      (position.side === ALXPositionSide.LONG && triggerPrice <= trailingStopLossTriggerPrice) ||
      (position.side === ALXPositionSide.SHORT && triggerPrice >= trailingStopLossTriggerPrice)
    ) {
      return {
        strategyName: this.name,
        params: {
          trailingStopLossTriggerPrice,
          triggerPrice,
          triggerSource: currentKline.type === 'full' ? 'kline-range' : 'current-price',
        },
        action: ExitStrategyAction.EXIT_CLOSE,
        kline: currentKline!,
      };
    }

    return false;
  }

  private getTriggerPrice(position: ALXPosition, currentKline: ALXKline): number {
    if (currentKline.type !== 'full') {
      return currentKline.close;
    }

    return position.side === ALXPositionSide.LONG ? currentKline.low : currentKline.high;
  }
}
