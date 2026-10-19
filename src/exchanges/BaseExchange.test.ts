import { describe, expect, test } from 'bun:test';
import type { ALXKline } from '@/domain/ALXKline';
import { BaseExchange } from './BaseExchange';

class TestExchange extends BaseExchange {
  public pushRealtimeKline(kline: ALXKline) {
    return this.addOrUpdateRealtimeKlineToBuffer(kline);
  }
}

function createKline(overrides: Partial<ALXKline> = {}): ALXKline {
  return {
    type: 'full',
    pair: 'BTCUSDT',
    timeframe: '1m',
    timestamp: 1_700_000_000_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    buyCost: 0,
    sellCost: 0,
    buyVolume: 10,
    sellVolume: 10,
    liqBuyCost: 0,
    liqSellCost: 0,
    liqBuyVolume: 0,
    liqSellVolume: 0,
    tradeCount: 1,
    liqCount: 0,
    ...overrides,
  };
}

describe('BaseExchange realtime kline buffering', () => {
  test('replaces a delta candle with the final full candle for the same timestamp', () => {
    const exchange = new TestExchange();

    exchange.pushRealtimeKline(
      createKline({
        type: 'delta',
        timestamp: 1_700_000_000_000,
        close: 101,
      })
    );
    const buffer = exchange.pushRealtimeKline(
      createKline({
        type: 'full',
        timestamp: 1_700_000_000_000,
        close: 102,
      })
    );

    expect(buffer.size).toBe(1);
    expect(buffer.getLast()?.type).toBe('full');
    expect(buffer.getLast()?.close).toBe(102);
  });
});
