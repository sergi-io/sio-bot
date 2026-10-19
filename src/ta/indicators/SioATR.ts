import { ATR, type HighLowClose } from 'trading-signals';
import type { BufferedIndicator } from '../BufferedIndicator.interfaces';
import { config } from '@/config';
import type { ALXKline } from '@/domain/ALXKline';
import { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { upsertIndicatorBufferValue } from '@/ta/helpers/upsertIndicatorBufferValue';

interface SioATRParams {
  id: string;
  period: number;
}

export type ATRBufferedIndicator = BufferedIndicator<number, number>;

/* @ts-expect-error Ignore typing here */
export class SioATR extends ATR implements ATRBufferedIndicator {
  public id: string = '';
  public buffer: RollingWindowBuffer<number>;

  constructor({ period, id }: SioATRParams) {
    super(period);
    this.id = id;
    this.buffer = new RollingWindowBuffer<number>(config.defaults.buffer.size);
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
    const result = this.getResult();
    if (result !== null) {
      upsertIndicatorBufferValue(this.buffer, result, isPartialUpdate);
    }
  }
}
