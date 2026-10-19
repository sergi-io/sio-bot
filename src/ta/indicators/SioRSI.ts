import { RSI } from 'trading-signals';
import type { BufferedIndicator } from '../BufferedIndicator.interfaces';
import { config } from '@/config';
import type { ALXKline } from '@/domain/ALXKline';
import { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { upsertIndicatorBufferValue } from '@/ta/helpers/upsertIndicatorBufferValue';

interface SioRSIParams {
  id: string;
  period: number;
}

export type RSIBufferedIndicator = BufferedIndicator<number, number>;

export class SioRSI extends RSI implements RSIBufferedIndicator {
  public id: string = '';
  public buffer: RollingWindowBuffer<number>;

  constructor({ period, id }: SioRSIParams) {
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
    if (isPartialUpdate && !isEmptyBuffer) {
      this.update(kline.close, true);
    } else {
      this.add(kline.close);
    }
    const result = this.getResult();
    if (result !== null) {
      upsertIndicatorBufferValue(this.buffer, result, isPartialUpdate);
    }
  }
}
