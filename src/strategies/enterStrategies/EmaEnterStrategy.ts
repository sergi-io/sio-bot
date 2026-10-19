import {
  EnterStrategyAction,
  type EnterStrategyActionExecuted,
  type EnterStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import { calculateTrendSlope } from '@/ta/helpers/calculateTrendSlope';
import type { EMABufferedIndicator } from '@/ta/indicators/SioEMA';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface EMAEnterStrategyParams {
  emaPeriod: number;
  slopePeriod: number;
  wickApproachRate: number;
  riskRewardRatio: number;
}

export class EMAEnterStrategy implements EnterStrategy {
  public name: string = 'EMAEnterStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;
  private params: EMAEnterStrategyParams;
  private ema: EMABufferedIndicator;

  constructor(bot: SioBot, params: EMAEnterStrategyParams) {
    this.bot = bot;
    this.params = params;
    if (this.params.slopePeriod > this.params.emaPeriod) {
      this.params.slopePeriod = this.params.emaPeriod;
    }
    // This needs to be set in the constructor
    this.ema = this.bot.taManager.getEMA(this.params.emaPeriod, this.bot.config.timeFrameToTrade);
  }

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): EnterStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      return false;
    }

    const currentEma = this.ema.buffer.getLast();

    if (currentEma === undefined) {
      return false;
    }

    const currentPrice = currentKline.close;
    const currentPriceUp = currentPrice > currentEma;
    const currentPriceDown = currentPrice < currentEma;

    if (currentEma === undefined) {
      return false;
    }

    logger.trace(
      `[${this.name}] -> Slope Period: ${this.params.slopePeriod}, EMA Period: ${this.params.emaPeriod}`
    );

    const slopeEmas: number[] = this.ema.buffer.getNLast(this.params.slopePeriod);
    logger.trace(`[${this.name}] -> Slope EMAs: ${slopeEmas.map((e) => e.toFixed(2)).join(', ')}`);
    const slope = calculateTrendSlope(slopeEmas);

    let wickApproachingEMA = false;
    if (currentEma !== 0) {
      const currentPriceWick = slope < 0 && currentPriceDown ? currentKline.high : currentKline.low;
      const diff = currentPriceWick - currentEma;
      const percentDiff = Math.abs((diff / currentEma) * 100);
      if (percentDiff <= this.params.wickApproachRate) {
        wickApproachingEMA = true;
      }
    }

    const closeUpEMA = currentKline.close > currentEma;
    const closeDownEMA = currentKline.close < currentEma;

    if (!this.bot.isBackTesting()) {
      logger.debug(
        `[${this.name}] -> Price: ${currentPrice} | EMA: ${currentEma.toFixed(2)} | WickNear: ${wickApproachingEMA} | Slope: ${slope.toFixed(2)}`
      );
    }

    let action: EnterStrategyAction | null = null;
    if (slope < 0 && currentPriceDown && wickApproachingEMA && closeDownEMA) {
      action = EnterStrategyAction.ENTER_SHORT;
    }

    if (slope > 0 && currentPriceUp && wickApproachingEMA && closeUpEMA) {
      action = EnterStrategyAction.ENTER_LONG;
    }

    if (!action) {
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
