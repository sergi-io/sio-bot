import { TAManager } from '@/ta/TAManager';
import type { SimpleBufferedIndicator } from '../BufferedIndicator.interfaces';
import { config } from '@/config';
import type { ALXKline } from '@/domain/ALXKline';
import { SioHighLows } from './SioHighLows';
import { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { upsertIndicatorBufferValue } from '@/ta/helpers/upsertIndicatorBufferValue';

interface SioTrendRibbonParams {
  id: string;
  period: number;
  taManager: TAManager;
}

export type TrendRibbonResult = 'up' | 'down' | 'flat';

export type TrendRibbonBufferedIndicator = SimpleBufferedIndicator<TrendRibbonResult>;

/**
 * SioTrendRibbon - Trend Ribbon Indicator
 * Based on: Donchian Trend Ribbon by LonesomeTheBlue (TradingView)
 */
export class SioTrendRibbon implements TrendRibbonBufferedIndicator {
  public id: string = '';
  public buffer: RollingWindowBuffer<TrendRibbonResult>;
  private taManager: TAManager;
  private highLowsTA: SioHighLows;

  constructor({ period, id, taManager }: SioTrendRibbonParams) {
    if (!period) {
      throw new Error('SioTrendRibbon: period is required');
    }
    this.id = id;
    this.buffer = new RollingWindowBuffer<TrendRibbonResult>(config.defaults.buffer.size);
    this.taManager = taManager;
    this.highLowsTA = this.taManager.getHighLows(period, false);
  }

  public addKline(
    kline: ALXKline,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _klineBuffer: RollingWindowBuffer<ALXKline>
  ): void {
    const isPartialUpdate = kline.type === 'delta';
    const close = kline.close;
    const highLows = this.highLowsTA.buffer.getAt(-1) ?? { hh: 0, ll: 0 };
    let trend: TrendRibbonResult = 'flat';

    if (close > highLows.hh) {
      trend = 'up';
    } else if (close < highLows.ll) {
      trend = 'down';
    } else {
      const lastTrend = this.buffer.getLast();
      trend = lastTrend ?? 'flat';
    }
    upsertIndicatorBufferValue(this.buffer, trend, isPartialUpdate);
  }

  public get isStable(): boolean {
    return this.highLowsTA.isStable && this.buffer.size > 0;
  }
}
