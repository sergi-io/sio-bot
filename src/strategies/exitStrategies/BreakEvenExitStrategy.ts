import {
  ExitStrategyAction,
  type ExitStrategyActionExecuted,
  type ExitStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import type { ALXKline } from '@/domain/ALXKline';
import type { ALXPosition } from '@/domain/ALXPosition';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface BreakEvenExitStrategyParams {
  profitToActivate: number;
  profitToProtect: number;
  maxGivebackRate: number;
}

export class BreakEvenExitStrategy implements ExitStrategy {
  public name: string = 'BreakEvenExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.DELTA_KLINE;
  public bot: SioBot;
  private params: BreakEvenExitStrategyParams;

  constructor(bot: SioBot, params: BreakEvenExitStrategyParams) {
    this.bot = bot;
    this.params = params;
  }

  public execute(
    klinesBuffer: RollingWindowBuffer<ALXKline>,
    position: ALXPosition
  ): ExitStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      return false;
    }

    const maxRealizedPnl = position.maxRealizedPnl ?? Number.NEGATIVE_INFINITY;
    const breakEvenArmed = maxRealizedPnl >= this.params.profitToActivate;
    const maxGivebackRate = Math.min(Math.max(this.params.maxGivebackRate, 0), 1);
    const protectedProfitFromPeak = maxRealizedPnl * (1 - maxGivebackRate);
    const protectedProfitThreshold = Math.max(
      this.params.profitToProtect,
      protectedProfitFromPeak
    );
    const profitFloorReached = position.realizedPnl <= protectedProfitThreshold;

    if (!breakEvenArmed || !profitFloorReached) {
      return false;
    }

    return {
      strategyName: this.name,
      params: {
        ...this.params,
        maxGivebackRate,
        maxRealizedPnl,
        realizedPnl: position.realizedPnl,
        protectedProfitThreshold,
      },
      action: ExitStrategyAction.EXIT_CLOSE,
      kline: currentKline,
    };
  }
}
