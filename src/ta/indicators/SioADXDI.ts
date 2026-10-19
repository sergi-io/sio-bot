import { ADX, type HighLowClose } from 'trading-signals';
import type { BufferedIndicator } from '../BufferedIndicator.interfaces';
import { config } from '@/config';
import type { ALXKline } from '@/domain/ALXKline';
import { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { upsertIndicatorBufferValue } from '@/ta/helpers/upsertIndicatorBufferValue';

interface SioADXParams {
  id: string;
  period: number;
}

interface ADXResult {
  adx: number;
  pdi: number;
  mdi: number;
}

export type ADXBufferedIndicator = BufferedIndicator<ADXResult, HighLowClose<number>>;

/* @ts-expect-error Ignore typing here */
export class SioADXDI extends ADX implements ADXBufferedIndicator {
  public id: string = '';
  public buffer: RollingWindowBuffer<ADXResult>;

  constructor({ period, id }: SioADXParams) {
    super(period);
    this.id = id;
    this.buffer = new RollingWindowBuffer<ADXResult>(config.defaults.buffer.size);
  }

  public addKline(
    kline: ALXKline,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _klineBuffer: RollingWindowBuffer<ALXKline>
  ): void {
    const isPartialUpdate = kline.type === 'delta';
    const isEmptyBuffer = this.buffer.size === 0;
    const highLowClose = {
      high: kline.high,
      low: kline.low,
      close: kline.close,
    } as HighLowClose<number>;

    if (isPartialUpdate && !isEmptyBuffer) {
      this.update(highLowClose, true);
    } else {
      this.add(highLowClose);
    }

    const adx = this.getResult();
    const pdi = this.pdi;
    const mdi = this.mdi;

    if (adx !== undefined && adx !== null && pdi !== undefined && mdi !== undefined) {
      const result = {
        adx,
        pdi,
        mdi,
      };
      upsertIndicatorBufferValue(this.buffer, result, isPartialUpdate);
    }
  }
}
