import type { DailyStats, JournalMetrics, JournalPosition } from '../types';

/**
 * Calculate all trading metrics from a list of positions
 */
export function calculateMetrics(positions: JournalPosition[]): JournalMetrics {
  if (positions.length === 0) {
    return {
      netPnl: 0,
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      avgWinLossRatio: 0,
      largestWin: 0,
      largestLoss: 0,
      avgTradePnl: 0,
      avgMae: 0,
    };
  }

  const wins = positions.filter((p) => p.realizedPnl > 0);
  const losses = positions.filter((p) => p.realizedPnl <= 0);

  const netPnl = positions.reduce((sum, p) => sum + p.realizedPnl, 0);
  const totalWins = wins.reduce((sum, p) => sum + p.realizedPnl, 0);
  const totalLosses = Math.abs(losses.reduce((sum, p) => sum + p.realizedPnl, 0));

  const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

  const avgMae = positions.reduce((sum, p) => sum + p.mae, 0) / positions.length;

  return {
    netPnl,
    totalTrades: positions.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: (wins.length / positions.length) * 100,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
    avgWin,
    avgLoss,
    avgWinLossRatio: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
    largestWin: wins.length > 0 ? Math.max(...wins.map((p) => p.realizedPnl)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map((p) => p.realizedPnl)) : 0,
    avgTradePnl: netPnl / positions.length,
    avgMae,
  };
}

/**
 * Group positions by their close date (YYYY-MM-DD)
 */
export function groupByDay(positions: JournalPosition[]): Record<string, DailyStats> {
  const dailyStats: Record<string, DailyStats> = {};

  for (const position of positions) {
    const date = new Date(position.closeTimestamp).toISOString().split('T')[0]!;

    if (!dailyStats[date]) {
      dailyStats[date] = {
        date,
        tradeCount: 0,
        winCount: 0,
        lossCount: 0,
        totalPnl: 0,
        positions: [],
      };
    }

    const dayStats = dailyStats[date]!;
    dayStats.tradeCount++;
    dayStats.totalPnl += position.realizedPnl;
    dayStats.positions.push(position);

    if (position.realizedPnl > 0) {
      dayStats.winCount++;
    } else {
      dayStats.lossCount++;
    }
  }

  return dailyStats;
}

/**
 * Build cumulative P&L array from daily stats
 */
export function calculateCumulativePnl(
  dailyStats: Record<string, DailyStats>
): { date: string; pnl: number }[] {
  const sortedDates = Object.keys(dailyStats).sort();
  const result: { date: string; pnl: number }[] = [];
  let cumulative = 0;

  for (const date of sortedDates) {
    cumulative += dailyStats[date]!.totalPnl;
    result.push({ date, pnl: cumulative });
  }

  return result;
}
