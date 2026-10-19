import { describe, expect, test } from 'bun:test';
import type { SioBot } from '@/siobot/SioBot';
import type { ALXKline } from '@/domain/ALXKline';
import { ALXOrderSide, ALXOrderType } from '@/domain/ALXOrder';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { RiskStrategyAction } from '@/risk/riskStrategies.types';
import { RiskRewardRatioExitStrategy } from '@/strategies/exitStrategies/RiskRewardRatioExitStrategy';
import { EnterStrategyAction } from '@/strategies/strategies.types';
import { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { PositionManager } from './PositionManager';

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

function createOpenPosition(overrides: Partial<ALXPosition> = {}): ALXPosition {
  return {
    id: 'pos-1',
    symbol: 'BTCUSDT',
    side: ALXPositionSide.LONG,
    entryPrice: 100,
    quantity: 1,
    margin: 100,
    leverage: 1,
    openTimestamp: 1_700_000_000_000,
    unrealizedPnl: 0,
    realizedPnl: 0,
    mae: 0,
    ...overrides,
  };
}

describe('PositionManager.syncPositionsFromExchange', () => {
  test('preserves live metadata across exchange refreshes and pending fills', async () => {
    let exchangePositions = [createOpenPosition()];
    const bot = {
      isBackTesting: () => false,
      exchange: {
        getOpenPositions: async () => exchangePositions,
      },
    } as unknown as SioBot;
    const positionManager = new PositionManager(bot);

    await positionManager.syncPositionsFromExchange();

    const existingPosition = positionManager.getOpenPositions()[0]!;
    existingPosition.openedByStrategies = [
      {
        strategyName: 'EMA',
        params: { riskRewardRatio: 2 },
        action: EnterStrategyAction.ENTER_LONG,
        kline: createKline(),
        riskRewardRatio: 2,
      },
    ];
    existingPosition.mae = 4.5;
    existingPosition.minRealizedPnl = -15;
    existingPosition.maxRealizedPnl = 25;
    existingPosition.unrealizedPnl = 12;
    existingPosition.realizedPnl = 10;
    existingPosition.enterFee = 1;
    existingPosition.exitFee = 1;

    positionManager.registerPendingOpenOrder({
      id: 'order-2',
      symbol: 'BTC/USDT:USDT',
      margin: 50,
      quantity: 0.5,
      leverage: 1,
      price: 101,
      side: ALXOrderSide.BUY,
      type: ALXOrderType.MARKET,
      openedTimestamp: 1_699_999_999_000,
      riskStrategiesExecuted: [
        {
          strategyName: 'DCA_1',
          params: {},
          action: RiskStrategyAction.DCA,
          executionTimestamp: 1_699_999_999_000,
          kline: createKline({ timestamp: 1_699_999_999_000 }),
        },
      ],
    });

    exchangePositions = [
      createOpenPosition({
        openTimestamp: 1_700_000_010_000,
        quantity: 1.5,
        margin: 150,
        unrealizedPnl: 0,
        realizedPnl: 0,
      }),
    ];

    await positionManager.syncPositionsFromExchange();

    const mergedPosition = positionManager.getOpenPositions()[0]!;
    expect(mergedPosition.openTimestamp).toBe(1_699_999_999_000);
    expect(mergedPosition.mae).toBe(4.5);
    expect(mergedPosition.minRealizedPnl).toBe(-15);
    expect(mergedPosition.maxRealizedPnl).toBe(25);
    expect(mergedPosition.unrealizedPnl).toBe(12);
    expect(mergedPosition.realizedPnl).toBe(10);
    expect(mergedPosition.enterFee).toBe(1);
    expect(mergedPosition.exitFee).toBe(1);
    expect(mergedPosition.openedByStrategies).toHaveLength(1);
    expect(mergedPosition.riskStrategiesExecuted).toHaveLength(1);

    const klineBuffer = new RollingWindowBuffer<ALXKline>(2);
    klineBuffer.push(
      createKline({
        timestamp: 1_700_000_020_000,
        high: 103,
        low: 99,
        close: 102.5,
      })
    );
    const strategy = new RiskRewardRatioExitStrategy(bot, {
      stopLossThresholdRate: 0.01,
    });
    const result = strategy.execute(klineBuffer, mergedPosition);

    expect(result).not.toBeFalse();
    expect(result && result.params.rewardPrice).toBeGreaterThan(mergedPosition.entryPrice);
  });
});
