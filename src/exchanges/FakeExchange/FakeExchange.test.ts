import { describe, expect, test } from 'bun:test';
import type { ALXKline } from '@/domain/ALXKline';
import { ALXOrderSide, ALXOrderType, type ALXOrder } from '@/domain/ALXOrder';
import { RiskStrategyAction } from '@/risk/riskStrategies.types';
import { EnterStrategyAction } from '@/strategies/strategies.types';
import { FakeExchange } from './FakeExchange';

class TestFakeExchange extends FakeExchange {
  constructor(private readonly injectedHistoricalKlines: ALXKline[]) {
    super({ initialBalance: 10_000, silent: true });
  }

  protected override async _readHistoricalData(): Promise<void> {
    this.historicalKlines = [...this.injectedHistoricalKlines];
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

function createOrder(overrides: Partial<ALXOrder> = {}): ALXOrder {
  return {
    id: 'order-1',
    symbol: 'BTCUSDT',
    margin: 100,
    quantity: 1,
    leverage: 1,
    price: 100,
    side: ALXOrderSide.BUY,
    type: ALXOrderType.MARKET,
    openedTimestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe('FakeExchange', () => {
  test('aggregates DCA orders using the correct weighted entry price', async () => {
    const exchange = new TestFakeExchange([]);

    await exchange.openOrder(
      createOrder({
        id: 'order-1',
        quantity: 1,
        price: 100,
        margin: 100,
        openedByStrategies: [
          {
            strategyName: 'EMA',
            params: { riskRewardRatio: 2 },
            action: EnterStrategyAction.ENTER_LONG,
            kline: createKline(),
            riskRewardRatio: 2,
          },
        ],
      }),
      true
    );
    await exchange.openOrder(
      createOrder({
        id: 'order-2',
        quantity: 2,
        price: 130,
        margin: 200,
        riskStrategiesExecuted: [
          {
            strategyName: 'DCA_1',
            params: {},
            action: RiskStrategyAction.DCA,
            executionTimestamp: 1_700_000_001_000,
            kline: createKline({ timestamp: 1_700_000_001_000, close: 130 }),
          },
        ],
      }),
      true
    );

    const positions = await exchange.getOpenPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]?.quantity).toBe(3);
    expect(positions[0]?.margin).toBe(300);
    expect(positions[0]?.entryPrice).toBe(120);
    expect(positions[0]?.openedByStrategies).toHaveLength(1);
    expect(positions[0]?.riskStrategiesExecuted).toHaveLength(1);
  });

  test('does not replay already-warmed historical candles when subscribing', async () => {
    const history = [
      createKline({ timeframe: '1m', timestamp: 1_700_000_000_000 }),
      createKline({ timeframe: '1m', timestamp: 1_700_000_060_000 }),
      createKline({ timeframe: '5m', timestamp: 1_700_000_060_000 }),
      createKline({ timeframe: '1m', timestamp: 1_700_000_120_000 }),
      createKline({ timeframe: '1m', timestamp: 1_700_000_180_000 }),
    ];
    const exchange = new TestFakeExchange(history);
    const replayedTimestamps: number[] = [];

    await exchange.warmUpKlinesBuffer('BTCUSDT', ['1m', '5m'], 2);
    await exchange.subscribeKlines('BTCUSDT', ['1m', '5m'], async (newKlines) => {
      replayedTimestamps.push(newKlines[0]!.timestamp);
    });

    expect(replayedTimestamps).toEqual([1_700_000_120_000, 1_700_000_180_000]);
    expect(exchange.getKlinesBuffer('BTCUSDT', '1m')?.getFirst()?.timestamp).toBe(
      1_700_000_000_000
    );
    expect(exchange.getKlinesBuffer('BTCUSDT', '1m')?.getLast()?.timestamp).toBe(
      1_700_000_180_000
    );
    expect(exchange.getKlinesBuffer('BTCUSDT', '5m')?.getLast()?.timestamp).toBe(
      1_700_000_060_000
    );
  });
});
