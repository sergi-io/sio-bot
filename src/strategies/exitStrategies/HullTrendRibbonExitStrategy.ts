import {
  ExitStrategyAction,
  type ExitStrategyActionExecuted,
  type ExitStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { HullBufferedIndicator } from '@/ta/indicators/SioHull';
import type { TrendRibbonBufferedIndicator } from '@/ta/indicators/SioTrendRibbon';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface HullTrendRibbonExitStrategyParams {
  hullPeriod: number;
  trendRibbonPeriod: number;
}

export class HullTrendRibbonExitStrategy implements ExitStrategy {
  public name: string = 'HullTrendRibbonExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;
  private params: HullTrendRibbonExitStrategyParams;
  private hullTA: HullBufferedIndicator;
  private trendRibbonTA: TrendRibbonBufferedIndicator;

  constructor(bot: SioBot, params: HullTrendRibbonExitStrategyParams) {
    this.bot = bot;
    this.params = params;
    this.hullTA = this.bot.taManager.getHull(
      this.params.hullPeriod,
      this.bot.config.timeFrameToTrade
    );
    this.trendRibbonTA = this.bot.taManager.getTrendRibbon(
      this.params.trendRibbonPeriod,
      this.bot.config.timeFrameToTrade
    );
  }

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): ExitStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      return false;
    }

    const currentHull = this.hullTA.buffer.getLast();
    const previousHull = this.hullTA.buffer.getAt(-1);
    const currentTrendRibbon = this.trendRibbonTA.buffer.getLast();

    if (
      currentHull === undefined ||
      previousHull === undefined ||
      currentTrendRibbon === undefined
    ) {
      return false;
    }

    if (!this.bot.isBackTesting()) {
      logger.debug(`[${this.name}] -> TrendRibbon: ${currentTrendRibbon}`);
    }

    let action: ExitStrategyAction | null = null;

    if (
      currentHull.hullTrend === 'up' &&
      previousHull.hullTrend === 'down' &&
      currentTrendRibbon === 'up'
    ) {
      action = ExitStrategyAction.EXIT_CLOSE;
    } else if (
      currentHull.hullTrend === 'down' &&
      previousHull.hullTrend === 'up' &&
      currentTrendRibbon === 'down'
    ) {
      action = ExitStrategyAction.EXIT_CLOSE;
    } else {
      return false;
    }

    return {
      kline: currentKline,
      strategyName: this.name,
      params: this.params,
      action,
    };
  }
}
