import { ATR } from 'trading-signals';
import type { SimpleBufferedIndicator } from '../BufferedIndicator.interfaces';
import { config } from '@/config';
import type { ALXKline } from '@/domain/ALXKline';
import { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { upsertIndicatorBufferValue } from '@/ta/helpers/upsertIndicatorBufferValue';

interface SioChandelierParams {
  id: string;
  atrPeriod: number;
  atrMultiplier: number;
}

export type ChandelierResult = {
  timestamp: number;
  longStop: number;
  shortStop: number;
  direction: 1 | -1; // 1 = bullish, -1 = bearish
  atr: number;
};

export type ChandelierBufferedIndicator = SimpleBufferedIndicator<ChandelierResult>;

/**
 * Chandelier Exit Indicator
 *
 * Based on TradingView's Chandelier Exit implementation.
 * Uses ATR to set trailing stop-loss levels based on volatility.
 *
 * - Long Stop = Highest High (over period) - ATR * multiplier
 * - Short Stop = Lowest Low (over period) + ATR * multiplier
 *
 * Direction changes when price crosses the stop levels.
 */
export class SioChandelier extends ATR implements ChandelierBufferedIndicator {
  public id: string = '';
  public buffer: RollingWindowBuffer<ChandelierResult>;
  private atrMultiplier: number;

  constructor({ atrPeriod, atrMultiplier, id }: SioChandelierParams) {
    super(atrPeriod);
    this.id = id;
    this.atrMultiplier = atrMultiplier;
    this.buffer = new RollingWindowBuffer<ChandelierResult>(config.defaults.buffer.size);
  }

  public addKline(
    kline: ALXKline,
    klineBuffer: RollingWindowBuffer<ALXKline>
  ): void {
    const isPartialUpdate = kline.type === 'delta';
    const isEmptyBuffer = this.buffer.size === 0;
    const candle = { high: kline.high, low: kline.low, close: kline.close };

    if (isPartialUpdate && !isEmptyBuffer) {
      this.update(candle, true);
    } else {
      this.add(candle);
    }

    // Get ATR result - may be null if not enough data
    const atr = this.getResult();
    if (atr === null) {
      return;
    }

    // Get highest high and lowest low over the ATR period
    const klines = klineBuffer.getNLast(this.interval);
    if (klines.length < this.interval) {
      return;
    }

    const highestHigh = Math.max(...klines.map((k) => k.high));
    const lowestLow = Math.min(...klines.map((k) => k.low));
    const previousResult = isPartialUpdate ? this.buffer.getAt(-1) : this.buffer.getLast();
    const prevLongStop = previousResult?.longStop ?? 0;
    const prevShortStop = previousResult?.shortStop ?? Infinity;
    let direction: 1 | -1 = previousResult?.direction ?? 1;

    // Calculate stop levels
    const longStopRaw = highestHigh - atr * this.atrMultiplier;
    const shortStopRaw = lowestLow + atr * this.atrMultiplier;

    // Apply trailing logic (stops only move in favorable direction)
    let longStop: number;
    let shortStop: number;

    if (direction === 1) {
      // In bullish trend, long stop can only go up
      longStop = Math.max(longStopRaw, prevLongStop);
      shortStop = shortStopRaw;
    } else {
      // In bearish trend, short stop can only go down
      longStop = longStopRaw;
      shortStop = Math.min(shortStopRaw, prevShortStop);
    }

    // Determine direction change
    if (kline.close > prevShortStop) {
      direction = 1;
    } else if (kline.close < prevLongStop) {
      direction = -1;
    }

    const result: ChandelierResult = {
      timestamp: kline.timestamp,
      longStop,
      shortStop,
      direction,
      atr,
    };

    upsertIndicatorBufferValue(this.buffer, result, isPartialUpdate);
  }

  public override get isStable(): boolean {
    return super.isStable && this.buffer.size > 0;
  }
}
