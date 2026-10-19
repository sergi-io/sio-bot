import type { SimpleBufferedIndicator } from '../BufferedIndicator.interfaces';
import { config } from '@/config';
import type { ALXKline } from '@/domain/ALXKline';
import { EMA } from 'trading-signals';
import { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { upsertIndicatorBufferValue } from '@/ta/helpers/upsertIndicatorBufferValue';

interface SioMTRSuperTrendParams {
  id: string;
  baseLen: number;
  mtrLen: number;
  factor: number;
}

export type MTRSuperTrendResult = {
  upperBand: number;
  lowerBand: number;
  superTrend: number;
  direction: 'bearish' | 'bullish';
};

export type MTRSuperTrendBufferedIndicator = SimpleBufferedIndicator<MTRSuperTrendResult>;

/**
 * MTR SuperTrend Indicator
 *
 * Based on Median True Range SuperTrend from TradingView.
 * Median TR SuperTrend | RakoQuant (tradingview.com)
 * Uses median-based calculations for more robust volatility measurement.
 *
 * - Baseline = Median of HL2 (high+low)/2 over baseLen periods
 * - MTR = Median True Range over mtrLen periods
 * - Both smoothed with EMA(3)
 * - SuperTrend bands: baseline_s +/- factor * mtr_s
 * - Direction: -1 = bullish (price above), 1 = bearish (price below)
 */
export class SioMTRSuperTrend implements MTRSuperTrendBufferedIndicator {
  public id: string;
  public buffer: RollingWindowBuffer<MTRSuperTrendResult>;

  private baseLen: number;
  private mtrLen: number;
  private factor: number;

  // Buffers for raw values
  private hl2Buffer: number[] = [];
  private trBuffer: number[] = [];

  // EMA smoothers (period 3)
  private baselineEMA: EMA;
  private mtrEMA: EMA;

  constructor({ id, baseLen, mtrLen, factor }: SioMTRSuperTrendParams) {
    this.id = id;
    this.baseLen = baseLen;
    this.mtrLen = mtrLen;
    this.factor = factor;

    this.baselineEMA = new EMA(3);
    this.mtrEMA = new EMA(3);

    this.buffer = new RollingWindowBuffer<MTRSuperTrendResult>(config.defaults.buffer.size);
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 !== 0) {
      return sorted[mid]!;
    }
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }

  public addKline(kline: ALXKline, _klineBuffer: RollingWindowBuffer<ALXKline>): void {
    const isPartialUpdate = kline.type === 'delta';
    const isEmptyBuffer = this.buffer.size === 0;
    const prevKline = _klineBuffer.getAt(-1);

    if (prevKline === undefined) {
      return;
    }

    // Calculate HL2 source
    const hl2 = (kline.high + kline.low) / 2;

    // Calculate True Range
    const tr = Math.max(
      kline.high - kline.low,
      Math.abs(kline.high - prevKline.close),
      Math.abs(kline.low - prevKline.close)
    );

    if (isPartialUpdate) {
      this.hl2Buffer.pop();
      this.trBuffer.pop();
    }

    // Add to buffers (maintain window size)
    this.hl2Buffer.push(hl2);
    if (this.hl2Buffer.length > this.baseLen) {
      this.hl2Buffer.shift();
    }

    this.trBuffer.push(tr);
    if (this.trBuffer.length > this.mtrLen) {
      this.trBuffer.shift();
    }

    // Need enough data
    if (this.hl2Buffer.length < this.baseLen || this.trBuffer.length < this.mtrLen) {
      return;
    }

    // Calculate medians
    const baselineRaw = this.median(this.hl2Buffer);
    const mtrRaw = this.median(this.trBuffer);

    // Update EMAs
    if (isPartialUpdate && !isEmptyBuffer) {
      this.baselineEMA.update(baselineRaw, true);
      this.mtrEMA.update(mtrRaw, true);
    } else {
      this.baselineEMA.add(baselineRaw);
      this.mtrEMA.add(mtrRaw);
    }

    const baselineSmoothed = this.baselineEMA.getResult();
    const mtrSmoothed = this.mtrEMA.getResult();

    if (baselineSmoothed === null || mtrSmoothed === null) {
      return;
    }

    // Calculate raw bands
    let upperBand = baselineSmoothed + this.factor * mtrSmoothed;
    let lowerBand = baselineSmoothed - this.factor * mtrSmoothed;
    const previousResult = isPartialUpdate ? this.buffer.getAt(-1) : this.buffer.getLast();
    const prevUpperBand = previousResult?.upperBand ?? 0;
    const prevLowerBand = previousResult?.lowerBand ?? Infinity;
    const prevSuperTrend = previousResult?.superTrend ?? 0;
    let direction: 'bearish' | 'bullish' = previousResult?.direction ?? 'bullish';

    // Apply trailing logic (SuperTrend)
    // Upper band can only move down (for bearish trend), reset if price closes above
    if (upperBand < prevUpperBand || prevKline.close > prevUpperBand) {
      // Keep new upper band
    } else {
      upperBand = prevUpperBand;
    }

    // Lower band can only move up (for bullish trend), reset if price closes below
    if (lowerBand > prevLowerBand || prevKline.close < prevLowerBand) {
      // Keep new lower band
    } else {
      lowerBand = prevLowerBand;
    }

    // Determine direction
    // direction: -1 = bullish (using lowerBand), 1 = bearish (using upperBand)
    if (prevSuperTrend === prevUpperBand) {
      // Was bearish
      direction = kline.close > upperBand ? 'bullish' : 'bearish';
    } else {
      // Was bullish
      direction = kline.close < lowerBand ? 'bearish' : 'bullish';
    }

    // SuperTrend line
    const superTrend = direction === 'bullish' ? lowerBand : upperBand;

    const result: MTRSuperTrendResult = {
      upperBand,
      lowerBand,
      superTrend,
      direction,
    };

    upsertIndicatorBufferValue(this.buffer, result, isPartialUpdate);
  }

  public get isStable(): boolean {
    return (
      this.hl2Buffer.length >= this.baseLen &&
      this.trBuffer.length >= this.mtrLen &&
      this.baselineEMA.isStable &&
      this.mtrEMA.isStable &&
      this.buffer.size > 0
    );
  }
}
