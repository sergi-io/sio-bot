import { describe, expect, it } from 'bun:test';
import { calculateMetrics, groupByDay, calculateCumulativePnl } from './metrics';
import type { JournalPosition } from '../types';

const createPosition = (overrides: Partial<JournalPosition> = {}): JournalPosition => ({
  id: '1',
  symbol: 'BTCUSDT',
  side: 'long',
  entryPrice: 50000,
  closePrice: 51000,
  quantity: 0.1,
  margin: 100,
  leverage: 10,
  openTimestamp: Date.now() - 3600000,
  closeTimestamp: Date.now(),
  enterFee: 0.5,
  exitFee: 0.5,
  realizedPnl: 99,
  mae: 2.5,
  minPnl: -5,
  maxPnl: 120,
  openedByStrategies: 'EMAEnterStrategy',
  closedByStrategy: 'ProfitExitStrategy',
  botConfigJson: '{}',
  ...overrides,
});

describe('calculateMetrics', () => {
  it('should return zero metrics for empty positions', () => {
    const metrics = calculateMetrics([]);
    expect(metrics.netPnl).toBe(0);
    expect(metrics.totalTrades).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.profitFactor).toBe(0);
  });

  it('should calculate correct metrics for winning trades', () => {
    const positions: JournalPosition[] = [
      createPosition({ id: '1', realizedPnl: 100 }),
      createPosition({ id: '2', realizedPnl: 50 }),
    ];

    const metrics = calculateMetrics(positions);
    expect(metrics.netPnl).toBe(150);
    expect(metrics.totalTrades).toBe(2);
    expect(metrics.winCount).toBe(2);
    expect(metrics.lossCount).toBe(0);
    expect(metrics.winRate).toBe(100);
    expect(metrics.avgWin).toBe(75);
    expect(metrics.largestWin).toBe(100);
  });

  it('should calculate correct metrics for mixed trades', () => {
    const positions: JournalPosition[] = [
      createPosition({ id: '1', realizedPnl: 100 }),
      createPosition({ id: '2', realizedPnl: -50 }),
      createPosition({ id: '3', realizedPnl: 25 }),
    ];

    const metrics = calculateMetrics(positions);
    expect(metrics.netPnl).toBe(75);
    expect(metrics.totalTrades).toBe(3);
    expect(metrics.winCount).toBe(2);
    expect(metrics.lossCount).toBe(1);
    expect(metrics.winRate).toBeCloseTo(66.67, 1);
    expect(metrics.profitFactor).toBe(2.5); // 125 / 50
    expect(metrics.avgWin).toBe(62.5);
    expect(metrics.avgLoss).toBe(50);
    expect(metrics.largestWin).toBe(100);
    expect(metrics.largestLoss).toBe(-50);
  });
});

describe('groupByDay', () => {
  it('should group positions by their close date', () => {
    const day1 = new Date('2025-01-15T10:00:00Z').getTime();
    const day1b = new Date('2025-01-15T15:00:00Z').getTime();
    const day2 = new Date('2025-01-16T12:00:00Z').getTime();

    const positions: JournalPosition[] = [
      createPosition({ id: '1', closeTimestamp: day1, realizedPnl: 100 }),
      createPosition({ id: '2', closeTimestamp: day1b, realizedPnl: -30 }),
      createPosition({ id: '3', closeTimestamp: day2, realizedPnl: 50 }),
    ];

    const dailyStats = groupByDay(positions);

    expect(Object.keys(dailyStats)).toHaveLength(2);
    expect(dailyStats['2025-01-15']).toBeDefined();
    expect(dailyStats['2025-01-16']).toBeDefined();

    expect(dailyStats['2025-01-15']!.tradeCount).toBe(2);
    expect(dailyStats['2025-01-15']!.totalPnl).toBe(70);
    expect(dailyStats['2025-01-15']!.winCount).toBe(1);
    expect(dailyStats['2025-01-15']!.lossCount).toBe(1);

    expect(dailyStats['2025-01-16']!.tradeCount).toBe(1);
    expect(dailyStats['2025-01-16']!.totalPnl).toBe(50);
  });
});

describe('calculateCumulativePnl', () => {
  it('should build cumulative P&L array from daily stats', () => {
    const dailyStats = {
      '2025-01-15': {
        date: '2025-01-15',
        tradeCount: 2,
        winCount: 1,
        lossCount: 1,
        totalPnl: 70,
        positions: [],
      },
      '2025-01-16': {
        date: '2025-01-16',
        tradeCount: 1,
        winCount: 1,
        lossCount: 0,
        totalPnl: 50,
        positions: [],
      },
      '2025-01-17': {
        date: '2025-01-17',
        tradeCount: 1,
        winCount: 0,
        lossCount: 1,
        totalPnl: -20,
        positions: [],
      },
    };

    const cumPnl = calculateCumulativePnl(dailyStats);

    expect(cumPnl).toHaveLength(3);
    expect(cumPnl[0]).toEqual({ date: '2025-01-15', pnl: 70 });
    expect(cumPnl[1]).toEqual({ date: '2025-01-16', pnl: 120 });
    expect(cumPnl[2]).toEqual({ date: '2025-01-17', pnl: 100 });
  });

  it('should return empty array for empty daily stats', () => {
    const cumPnl = calculateCumulativePnl({});
    expect(cumPnl).toHaveLength(0);
  });
});
