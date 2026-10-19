import {
  EnterStrategyAction,
  type EnterStrategyActionExecuted,
  type EnterStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface ManualEnterStrategyParams {
  enterSide: 'long' | 'short';
}

export class ManualEnterStrategy implements EnterStrategy {
  public name: string = 'ManualEnterStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE; // Doesn't matter for manual enter
  public bot: SioBot;
  private params: ManualEnterStrategyParams;

  constructor(bot: SioBot, params: ManualEnterStrategyParams) {
    this.bot = bot;
    this.params = params;
  }

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): EnterStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      return false;
    }

    const action =
      this.params.enterSide === 'long'
        ? EnterStrategyAction.ENTER_LONG
        : EnterStrategyAction.ENTER_SHORT;

    return {
      kline: currentKline,
      strategyName: this.name,
      params: this.params,
      action,
      riskRewardRatio: 0,
    };
  }
}
