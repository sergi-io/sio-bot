import {
  EnterStrategyAction,
  type EnterStrategyActionExecuted,
  type EnterStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import type {
  ChandelierBufferedIndicator,
  ChandelierResult,
} from '@/ta/indicators/SioChandelier';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import meanBy from 'lodash/meanBy';

interface ChandelierTurboWickEnterStrategyParams {
  atrMultiplier: number;
  period: number;
  candleSizeRate: number;
  timeFrame: ALXTimeFrame;
  riskRewardRatio: number;
}

export class ChandelierTurboWickEnterStrategy implements EnterStrategy {
  public name: string = 'ChandelierTurboWickEnterStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;
  private params: ChandelierTurboWickEnterStrategyParams;
  private chandelierTA: ChandelierBufferedIndicator;

  constructor(bot: SioBot, params: ChandelierTurboWickEnterStrategyParams) {
    this.bot = bot;
    this.params = { ...params };

    this.chandelierTA = this.bot.taManager.getChandelier(
      this.params.period,
      this.params.atrMultiplier,
      this.params.timeFrame
    );
  }

  public execute(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    klinesBuffer: RollingWindowBuffer<ALXKline>
  ): EnterStrategyActionExecuted | false {
    const klinesBufferToScan = this.bot.exchange.getKlinesBuffer(
      this.bot.config.assetSymbol,
      this.params.timeFrame
    );

    if (!klinesBufferToScan) {
      return false;
    }

    const pastKlines = klinesBufferToScan.getNLast(this.params.period);
    const currentKline = pastKlines.pop();

    const pastCandleSizeAvg = meanBy(pastKlines, (candle) => Math.abs(candle.high - candle.low));

    // Pop the last candle size average

    if (!currentKline) {
      return false;
    }

    const currentCandleSize = Math.abs(currentKline.high - currentKline.low);

    // Ensure the current candle is significantly larger than the average of the past candles

    const currentCandleSizeRate = Math.abs(1 - pastCandleSizeAvg / currentCandleSize);
    const currentChandelier = this.chandelierTA.buffer.getLast();

    if (!this.bot.isBackTesting()) {
      logger.debug(
        `[${this.name}] -> KlineSizeRate: ${currentCandleSizeRate.toFixed(2)} - PastCandleSizeAvg: ${pastCandleSizeAvg.toFixed(2)} - CurrentCandleSize: ${currentCandleSize.toFixed(2)} - Chandelier Values: ${JSON.stringify(currentChandelier)}`
      );
    }

    if (currentCandleSizeRate < this.params.candleSizeRate || !currentChandelier) {
      return false;
    }

    // ALX Encyclopedia: A turbo wick is a candle with a long wick that bounces off a support/resistance level
    const { isTurboWickCross, touchingSide } = this._detectTurboWickCrossingChandelier(
      currentKline,
      currentChandelier
    );

    if (!this.bot.isBackTesting()) {
      logger.debug(
        `[${this.name}] -> isTurboWickCross: ${isTurboWickCross} - side: ${touchingSide} - Chandelier Values: ${JSON.stringify(currentChandelier)}`
      );
    }

    if (!isTurboWickCross || !touchingSide) {
      return false;
    }

    let action: EnterStrategyAction | null = null;

    if (touchingSide === 'up') {
      action = EnterStrategyAction.ENTER_SHORT;
    } else if (touchingSide === 'down') {
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

  private _detectTurboWickCrossingChandelier(
    kline: ALXKline,
    chandelier: ChandelierResult
  ): {
    isTurboWickCross: boolean;
    touchingSide: 'up' | 'down' | null;
  } {
    const candleIsRed = kline.close - kline.open < 0;
    const upperWickSize = {
      high: kline.high,
      low: candleIsRed ? kline.open : kline.close,
    };
    const lowerWickSize = {
      high: candleIsRed ? kline.close : kline.open,
      low: kline.low,
    };

    if (chandelier.shortStop < lowerWickSize.high && chandelier.shortStop > lowerWickSize.low) {
      return { isTurboWickCross: true, touchingSide: 'down' };
    } else if (
      chandelier.longStop > upperWickSize.low &&
      chandelier.longStop < upperWickSize.high
    ) {
      return { isTurboWickCross: true, touchingSide: 'up' };
    }

    return { isTurboWickCross: false, touchingSide: null };
  }
}
