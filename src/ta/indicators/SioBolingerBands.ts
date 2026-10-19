import { type BufferedIndicator } from '../BufferedIndicator.interfaces';
import { BollingerBands, type BandsResult } from 'trading-signals';
import { config } from '@/config';
import type { ALXKline } from '@/domain/ALXKline';
import { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { upsertIndicatorBufferValue } from '@/ta/helpers/upsertIndicatorBufferValue';

interface SioBollingerBandsParams {
  id: string;
  period: number;
  deviationMultiple: number;
}

export type BollingerBandsBufferedIndicator = BufferedIndicator<BandsResult, number>;

export class SioBollingerBands
  extends BollingerBands
  implements BollingerBandsBufferedIndicator
{
  public id: string = '';
  public buffer: RollingWindowBuffer<BandsResult>;

  constructor({ period, deviationMultiple, id }: SioBollingerBandsParams) {
    super(period, deviationMultiple);
    this.id = id;
    this.buffer = new RollingWindowBuffer<BandsResult>(config.defaults.buffer.size);
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
