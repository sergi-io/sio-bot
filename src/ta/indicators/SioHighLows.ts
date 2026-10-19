import type { SimpleBufferedIndicator } from '../BufferedIndicator.interfaces';
import { config } from '@/config';
import type { ALXKline } from '@/domain/ALXKline';
import { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { upsertIndicatorBufferValue } from '@/ta/helpers/upsertIndicatorBufferValue';

interface SioHighLowsParams {
  id: string;
  period: number;
  includeCurrentKline: boolean;
}

export type HighLowsResult = {
  hh: number;
  ll: number;
};

export type HighLowsBufferedIndicator = SimpleBufferedIndicator<HighLowsResult>;

export class SioHighLows implements HighLowsBufferedIndicator {
  public id: string = '';
  public buffer: RollingWindowBuffer<HighLowsResult>;
  private period: number;
  private includeCurrentKline: boolean;
  private hasEnoughData: boolean = false;

  constructor({ period, id, includeCurrentKline }: SioHighLowsParams) {
    this.id = id;
    this.period = period;
    this.includeCurrentKline = includeCurrentKline;
    this.buffer = new RollingWindowBuffer<HighLowsResult>(config.defaults.buffer.size);
  }

  /** TODO: Maybe we should use high, and low from the KLINE instead of close */
  public addKline(
    kline: ALXKline,
    klineBuffer: RollingWindowBuffer<ALXKline>
  ): void {
    const isPartialUpdate = kline.type === 'delta';
    const requiredKlines = this.period + (this.includeCurrentKline ? 0 : 1);
    const klinesToScan = klineBuffer.getNLast(requiredKlines);

    if (klinesToScan.length < requiredKlines) {
      return;
    }

    const currentKlineInBuffer =
      klinesToScan[klinesToScan.length - 1]?.timestamp === kline.timestamp;

    if (!this.includeCurrentKline && currentKlineInBuffer) {
      klinesToScan.pop();
    }

    if (klinesToScan.length < this.period) {
      return;
    }

    const klinesHighToConsider = klinesToScan.map((k) => k.high);
    const klinesLowToConsider = klinesToScan.map((k) => k.low);
    const hh = Math.max(...klinesHighToConsider);
    const ll = Math.min(...klinesLowToConsider);
    const result: HighLowsResult = { hh, ll };
    this.hasEnoughData = true;
    upsertIndicatorBufferValue(this.buffer, result, isPartialUpdate);
  }

  public get isStable(): boolean {
    return this.hasEnoughData && this.buffer.size > 0;
  }
}
