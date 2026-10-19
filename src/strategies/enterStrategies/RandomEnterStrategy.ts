import {
  EnterStrategyAction,
  type EnterStrategyActionExecuted,
  type EnterStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

export class RandomEnterStrategy implements EnterStrategy {
  public name: string = 'RandomEnterStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;

  constructor(bot: SioBot) {
    this.bot = bot;
  }

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): EnterStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      return false;
    }

    // Generate random decision with equal probability distribution (33.33% each)
    const random = Math.random();
    let action: EnterStrategyAction;

    if (random < 0.33333) {
      action = EnterStrategyAction.ENTER_LONG;
    } else if (random < 0.66666) {
      action = EnterStrategyAction.ENTER_SHORT;
    } else {
      return false;
    }

    if (!this.bot.isBackTesting()) {
      logger.debug(
        `[${this.name}] -> Randomly decided to ${action} at price ${currentKline.close}`
      );
    }

    return {
      kline: currentKline,
      strategyName: this.name,
      params: {},
      action,
      riskRewardRatio: 1,
    };
  }
}
