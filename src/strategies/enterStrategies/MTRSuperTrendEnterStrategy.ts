import {
  EnterStrategyAction,
  type EnterStrategyActionExecuted,
  type EnterStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { MTRSuperTrendBufferedIndicator } from '@/ta/indicators/SioMTRSuperTrend';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface MTRSuperTrendEnterStrategyParams {
  baseLen: number;
  mtrLen: number;
  factor: number;
  riskRewardRatio: number;
}

export class MTRSuperTrendEnterStrategy implements EnterStrategy {
  public name: string = 'MTRSuperTrendEnterStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;
  private params: MTRSuperTrendEnterStrategyParams;
  private mtrSuperTrendTA: MTRSuperTrendBufferedIndicator;

  constructor(bot: SioBot, params: MTRSuperTrendEnterStrategyParams) {
    this.bot = bot;
    this.params = params;

    const timeFrameToTrade = this.bot.config.timeFrameToTrade;
    this.mtrSuperTrendTA = this.bot.taManager.getMTRSuperTrend(
      this.params.baseLen,
      this.params.mtrLen,
      this.params.factor,
      timeFrameToTrade
    );
  }

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): EnterStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      return false;
    }

    const currentMTR = this.mtrSuperTrendTA.buffer.getLast();
    const previousMTR = this.mtrSuperTrendTA.buffer.getAt(-1);

    if (!currentMTR || !previousMTR) {
      return false;
    }

    if (!this.bot.isBackTesting()) {
      logger.debug(
        `[${this.name}] -> Direction: ${currentMTR.direction} (prev: ${previousMTR.direction}) - ST: ${currentMTR.superTrend.toFixed(4)}`
      );
    }

    let action: EnterStrategyAction | null = null;

    // bullFlip: direction changes from 1 (bearish) to -1 (bullish)
    if (currentMTR.direction === 'bullish' && previousMTR.direction === 'bearish') {
      action = EnterStrategyAction.ENTER_LONG;
    }
    // bearFlip: direction changes from -1 (bullish) to 1 (bearish)
    else if (currentMTR.direction === 'bearish' && previousMTR.direction === 'bullish') {
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
