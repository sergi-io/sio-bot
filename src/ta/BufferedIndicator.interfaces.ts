import type { ALXKline } from '@/domain/ALXKline';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import type { TechnicalIndicator } from 'trading-signals';

export interface BufferedIndicator<T = any, U = number> extends TechnicalIndicator<T, U> {
  id: string;
  buffer: RollingWindowBuffer<T>;
  addKline(kline: ALXKline, klineBuffer: RollingWindowBuffer<ALXKline>): void;
}

export interface SimpleBufferedIndicator<T = any> {
  id: string;
  buffer: RollingWindowBuffer<T>;
  readonly isStable: boolean;
  addKline(kline: ALXKline, klineBuffer: RollingWindowBuffer<ALXKline>): void;
}
