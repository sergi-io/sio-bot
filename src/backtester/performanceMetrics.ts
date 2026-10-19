import type { ALXPosition } from '@/domain/ALXPosition';

const EPSILON = 1e-9;

export const calculateProfitFactor = (positions: ALXPosition[]): number => {
  const closedPositions = positions.filter((position) => position.closeTimestamp !== undefined);
  const grossProfit = closedPositions.reduce(
    (sum, position) => sum + Math.max(position.realizedPnl, 0),
    0
  );
  const grossLoss = Math.abs(
    closedPositions.reduce((sum, position) => sum + Math.min(position.realizedPnl, 0), 0)
  );

  if (grossLoss <= EPSILON) {
    return grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
  }

  return grossProfit / grossLoss;
};

export const calculateSharpeRatio = (positions: ALXPosition[]): number => {
  const tradeReturns = positions
    .filter((position) => position.closeTimestamp !== undefined)
    .map((position) => {
      if (position.margin <= 0) {
        return 0;
      }

      const tradeReturn = position.realizedPnl / position.margin;
      return Number.isFinite(tradeReturn) ? tradeReturn : 0;
    });

  if (tradeReturns.length === 0) {
    return 0;
  }

  const meanReturn =
    tradeReturns.reduce((sum, tradeReturn) => sum + tradeReturn, 0) / tradeReturns.length;
  const variance =
    tradeReturns.reduce(
      (sum, tradeReturn) => sum + (tradeReturn - meanReturn) * (tradeReturn - meanReturn),
      0
    ) / tradeReturns.length;

  if (variance <= EPSILON) {
    if (meanReturn > 0) {
      return Number.POSITIVE_INFINITY;
    }
    if (meanReturn < 0) {
      return Number.NEGATIVE_INFINITY;
    }
    return 0;
  }

  return (meanReturn / Math.sqrt(variance)) * Math.sqrt(tradeReturns.length);
};

export const formatPerformanceMetric = (value: number, decimals: number = 2): string => {
  if (!Number.isFinite(value)) {
    return value > 0 ? '∞' : value < 0 ? '-∞' : '0';
  }

  return value.toFixed(decimals);
};
