import type { SimpleBufferedIndicator } from '../BufferedIndicator.interfaces';
import { config } from '@/config';
import type { ALXKline } from '@/domain/ALXKline';
import { WMA } from 'trading-signals';
import { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { upsertIndicatorBufferValue } from '@/ta/helpers/upsertIndicatorBufferValue';

interface SioHullParams {
  id: string;
  period: number;
}

export interface HullResult {
  timestamp: number;
  mHull: number;
  sHull: number;
  hullTrend: 'up' | 'down' | 'flat';
}

export type HullBufferedIndicator = SimpleBufferedIndicator<HullResult>;

/**
 * SioHull - Hull Moving Average Indicator
 *
 * The Hull Moving Average (HMA) is designed to reduce lag and improve smoothing
 * Based on: Hull Suite indicator by Insilico (TradingView)
 * We use the THMA mode to calculate the HMA, which is the Triple Hull Moving Average
 * and react faster to price changes.
 */
export class SioHull implements HullBufferedIndicator {
  public id: string = '';
  public buffer: RollingWindowBuffer<HullResult>;
  private _taWMA1: WMA; // period / 3
  private _taWMA2: WMA; // period / 2
  private _taWMA3: WMA; // period
  private _taWMAHull: WMA;

  constructor({ period, id }: SioHullParams) {
    this.id = id;
    this.buffer = new RollingWindowBuffer<HullResult>(config.defaults.buffer.size);
    // THMA formula: wma(wma(src, period/3) * 3 - wma(src, period/2) - wma(src, period), period)
    this._taWMA1 = new WMA(Math.round(period / 3 / 2));
    this._taWMA2 = new WMA(Math.round(period / 2 / 2));
    this._taWMA3 = new WMA(Math.round(period / 2));
    this._taWMAHull = new WMA(Math.round(period / 2));
  }

  public addKline(
    kline: ALXKline,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _klineBuffer: RollingWindowBuffer<ALXKline>
  ): void {
    const isPartialUpdate = kline.type === 'delta';
    const isEmptyBuffer = this.buffer.size === 0;
    if (!isPartialUpdate || isEmptyBuffer) {
      this._taWMA1.add(kline.close);
      this._taWMA2.add(kline.close);
      this._taWMA3.add(kline.close);
    } else {
      this._taWMA1.update(kline.close, true);
      this._taWMA2.update(kline.close, true);
      this._taWMA3.update(kline.close, true);
    }
    const wma1Result = this._taWMA1.getResult();
    const wma2Result = this._taWMA2.getResult();
    const wma3Result = this._taWMA3.getResult();

    if (!wma1Result || !wma2Result || !wma3Result) {
      return;
    }
    // THMA = wma(wma(src, period/3) * 3 - wma(src, period/2) - wma(src, period), period)

    const thmaDiff = wma1Result * 3 - wma2Result - wma3Result;

    if (!isPartialUpdate || isEmptyBuffer) {
      this._taWMAHull.add(thmaDiff);
    } else {
      this._taWMAHull.update(thmaDiff, true);
    }
    const mHull = this._taWMAHull.getResult();
    if (mHull === null) {
      return;
    }

    const sHull = this.buffer.getAt(-1)?.mHull;

    let hullTrend: 'up' | 'down' | 'flat' = 'flat';

    if (mHull && sHull) {
      if (mHull > sHull) {
        hullTrend = 'up';
      } else if (mHull < sHull) {
        hullTrend = 'down';
      }
    }

    upsertIndicatorBufferValue(
      this.buffer,
      {
        timestamp: kline.timestamp,
        mHull,
        sHull: sHull ?? mHull,
        hullTrend,
      },
      isPartialUpdate
    );
  }

  public get isStable(): boolean {
    return this._taWMAHull.isStable && this.buffer.size > 0;
  }
}
