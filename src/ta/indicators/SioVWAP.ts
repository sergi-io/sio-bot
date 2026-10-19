import { config } from '@/config';
import type { ALXKline } from '@/domain/ALXKline';
import type { SimpleBufferedIndicator } from '../BufferedIndicator.interfaces';
import { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { upsertIndicatorBufferValue } from '@/ta/helpers/upsertIndicatorBufferValue';
import { VWAP } from 'trading-signals';

interface SioVWAPParams {
  id: string;
}

export interface VWAPBands {
  upper: number;
  lower: number;
}

export interface VWAPResult {
  vwap: number;
  bands: VWAPBands;
  distanceFromVWAP: number;
  distanceFromVWAPPct: number;
  isAboveVWAP: boolean;
  isBelowVWAP: boolean;
  bias: 'bullish' | 'bearish' | 'neutral';
}

export type VWAPBufferedIndicator = SimpleBufferedIndicator<VWAPResult>;

function getSessionStartTimestamp(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getTypicalPrice(kline: ALXKline): number {
  return (kline.high + kline.low + kline.close) / 3;
}

function getCandleVolume(kline: ALXKline): number {
  return kline.buyVolume + kline.sellVolume;
}

export class SioVWAP implements VWAPBufferedIndicator {
  public id: string;
  public buffer: RollingWindowBuffer<VWAPResult>;
  private indicator: VWAP;
  private currentSessionStartTimestamp: number | null;
  private sessionKlines: ALXKline[];

  constructor({ id }: SioVWAPParams) {
    this.id = id;
    this.buffer = new RollingWindowBuffer<VWAPResult>(config.defaults.buffer.size);
    this.indicator = new VWAP();
    this.currentSessionStartTimestamp = null;
    this.sessionKlines = [];
  }

  public addKline(kline: ALXKline, klineBuffer: RollingWindowBuffer<ALXKline>): void {
    const sessionStartTimestamp = getSessionStartTimestamp(kline.timestamp);
    const isNewSession = this.currentSessionStartTimestamp !== sessionStartTimestamp;

    if (isNewSession) {
      this.resetSession(sessionStartTimestamp, klineBuffer);
    }

    const replace = kline.type === 'delta' && !isNewSession;
    const vwap = this.indicator.update(this.toVWAPInput(kline), replace);
    if (vwap === null) {
      return;
    }

    if (replace && this.sessionKlines.length > 0) {
      this.sessionKlines[this.sessionKlines.length - 1] = kline;
    } else {
      this.sessionKlines.push(kline);
    }

    let weightedVarianceSum = 0;
    let cumulativeVolume = 0;
    cumulativeVolume = 0;
    for (const sessionKline of this.sessionKlines) {
      const volume = getCandleVolume(sessionKline);
      if (volume <= 0) {
        continue;
      }
      cumulativeVolume += volume;
      const typicalPrice = getTypicalPrice(sessionKline);
      weightedVarianceSum += volume * (typicalPrice - vwap) ** 2;
    }

    const standardDeviation = Math.sqrt(weightedVarianceSum / cumulativeVolume);
    const currentPrice = kline.close;
    const distanceFromVWAP = currentPrice - vwap;
    const distanceFromVWAPPct = vwap === 0 ? 0 : (distanceFromVWAP / vwap) * 100;
    const result: VWAPResult = {
      vwap,
      bands: { upper: vwap + standardDeviation, lower: vwap - standardDeviation },
      distanceFromVWAP,
      distanceFromVWAPPct,
      isAboveVWAP: currentPrice > vwap,
      isBelowVWAP: currentPrice < vwap,
      bias: currentPrice > vwap ? 'bullish' : currentPrice < vwap ? 'bearish' : 'neutral',
    };

    upsertIndicatorBufferValue(this.buffer, result, replace);
  }

  private resetSession(
    sessionStartTimestamp: number,
    klineBuffer: RollingWindowBuffer<ALXKline>
  ): void {
    this.currentSessionStartTimestamp = sessionStartTimestamp;
    this.indicator = new VWAP();
    this.sessionKlines = [];

    const sessionKlines = this.getSessionKlines(klineBuffer, sessionStartTimestamp);
    for (const sessionKline of sessionKlines.slice(0, -1)) {
      const result = this.indicator.update(this.toVWAPInput(sessionKline), false);
      if (result !== null) {
        this.sessionKlines.push(sessionKline);
      }
    }
  }

  private getSessionKlines(
    klineBuffer: RollingWindowBuffer<ALXKline>,
    sessionStartTimestamp: number
  ): ALXKline[] {
    return klineBuffer
      .toArray()
      .filter(
        (bufferedKline) =>
          getSessionStartTimestamp(bufferedKline.timestamp) === sessionStartTimestamp
      );
  }

  private toVWAPInput(kline: ALXKline): {
    high: number;
    low: number;
    close: number;
    volume: number;
  } {
    return {
      high: kline.high,
      low: kline.low,
      close: kline.close,
      volume: getCandleVolume(kline),
    };
  }

  public get isStable(): boolean {
    return this.indicator.isStable && this.buffer.size > 0;
  }
}
