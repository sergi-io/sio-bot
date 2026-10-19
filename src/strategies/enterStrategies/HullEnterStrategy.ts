import {
  EnterStrategyAction,
  type EnterStrategyActionExecuted,
  type EnterStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { HullBufferedIndicator } from '@/ta/indicators/SioHull';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface HullEnterStrategyParams {
  hullPeriod: number;
  riskRewardRatio: number;
}

export class HullEnterStrategy implements EnterStrategy {
  public name: string = 'HullEnterStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;
  private params: HullEnterStrategyParams;
  private hullTA: HullBufferedIndicator;

  constructor(bot: SioBot, params: HullEnterStrategyParams) {
    this.bot = bot;
    this.params = params;
    const timeFrameToTrade = this.bot.config.timeFrameToTrade;
    this.hullTA = this.bot.taManager.getHull(this.params.hullPeriod, timeFrameToTrade);
  }

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): EnterStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      return false;
    }

    const currentHull = this.hullTA.buffer.getLast();
    const previousHull = this.hullTA.buffer.getAt(-1);

    if (!currentHull || !previousHull) {
      return false;
    }

    if (!this.bot.isBackTesting()) {
      logger.debug(`[${this.name}] -> Hull: ${currentHull.hullTrend}`);
    }

    let action: EnterStrategyAction | null = null;

    if (currentHull.hullTrend === 'up' && previousHull.hullTrend === 'down') {
      action = EnterStrategyAction.ENTER_LONG;
    } else if (currentHull.hullTrend === 'down' && previousHull.hullTrend === 'up') {
      action = EnterStrategyAction.ENTER_SHORT;
    } else {
      return false;
    }

    return {
      kline: currentKline,
      strategyName: this.name,
      params: this.params,
      action,
      riskRewardRatio: this.params.riskRewardRatio,
    };
  }
}
