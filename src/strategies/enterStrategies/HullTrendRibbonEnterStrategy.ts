import {
  EnterStrategyAction,
  type EnterStrategyActionExecuted,
  type EnterStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { HullBufferedIndicator } from '@/ta/indicators/SioHull';
import type { TrendRibbonBufferedIndicator } from '@/ta/indicators/SioTrendRibbon';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface HullTrendRibbonEnterStrategyParams {
  hullPeriod: number;
  trendRibbonPeriod: number;
  riskRewardRatio: number;
}

export class HullTrendRibbonEnterStrategy implements EnterStrategy {
  public name: string = 'HullTrendRibbonEnterStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;
  private params: HullTrendRibbonEnterStrategyParams;
  private hullTA: HullBufferedIndicator;
  private trendRibbonTA: TrendRibbonBufferedIndicator;

  constructor(bot: SioBot, params: HullTrendRibbonEnterStrategyParams) {
    this.bot = bot;
    this.params = params;
    const timeFrameToTrade = this.bot.config.timeFrameToTrade;
    this.hullTA = this.bot.taManager.getHull(this.params.hullPeriod, timeFrameToTrade);
    this.trendRibbonTA = this.bot.taManager.getTrendRibbon(
      this.params.trendRibbonPeriod,
      timeFrameToTrade
    );
  }

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): EnterStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      return false;
    }

    const currentHull = this.hullTA.buffer.getLast();
    const previousHull = this.hullTA.buffer.getAt(-1);
    const currentTrendRibbon = this.trendRibbonTA.buffer.getLast();

    if (!currentHull || !previousHull) {
      return false;
    }

    if (!this.bot.isBackTesting()) {
      logger.debug(
        `[${this.name}] -> TrendRibbon: ${currentTrendRibbon} - Hull: ${currentHull.hullTrend}`
      );
    }

    let action: EnterStrategyAction | null = null;

    if (
      currentHull.hullTrend === 'up' &&
      previousHull.hullTrend === 'down' &&
      currentTrendRibbon === 'up'
    ) {
      action = EnterStrategyAction.ENTER_LONG;
    } else if (
      currentHull.hullTrend === 'down' &&
      previousHull.hullTrend === 'up' &&
      currentTrendRibbon === 'down'
    ) {
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
