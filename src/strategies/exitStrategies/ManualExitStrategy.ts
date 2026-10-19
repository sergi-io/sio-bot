import {
  ExitStrategyAction,
  type ExitStrategyActionExecuted,
  type ExitStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

export class ManualExitStrategy implements ExitStrategy {
  public name: string = 'ManualExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE; // Doesn't matter for manual exit
  public bot: SioBot;

  constructor(bot: SioBot) {
    this.bot = bot;
  }

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): ExitStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      return false;
    }

    return {
      strategyName: this.name,
      params: {},
      action: ExitStrategyAction.EXIT_CLOSE,
      kline: currentKline!,
    };
  }
}
