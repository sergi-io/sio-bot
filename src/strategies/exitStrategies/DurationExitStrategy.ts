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

interface DurationExitStrategyParams {
  maxTimeHoldingSeconds: number;
}

export class DurationExitStrategy implements ExitStrategy {
  public name: string = 'DurationExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  private params: DurationExitStrategyParams;

  constructor(bot: SioBot, params: DurationExitStrategyParams) {
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

    const positionTimestamp = position.openTimestamp;
    const currentTime = currentKline.timestamp;

    const timeHoldingSeconds = (currentTime - positionTimestamp) / 1000;

    if (timeHoldingSeconds >= this.params.maxTimeHoldingSeconds) {
      return {
        strategyName: this.name,
        params: this.params,
        action: ExitStrategyAction.EXIT_CLOSE,
        kline: currentKline!,
      };
    }

    return false;
  }
}
