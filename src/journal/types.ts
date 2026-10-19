/**
 * Position data formatted for journal display
 */
export interface JournalPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  closePrice: number;
  quantity: number;
  margin: number;
  leverage: number;
  openTimestamp: number;
  closeTimestamp: number;
  enterFee: number;
  exitFee: number;
  realizedPnl: number;
  mae: number;
  minPnl: number;
  maxPnl: number;
  openedByStrategies: string;
  closedByStrategy: string;
  botConfigJson: string;
}

/**
 * Daily statistics for calendar display
 */
export interface DailyStats {
  date: string; // YYYY-MM-DD
  tradeCount: number;
  winCount: number;
  lossCount: number;
  totalPnl: number;
  positions: JournalPosition[];
}

/**
 * Aggregated trading metrics
 */
export interface JournalMetrics {
  netPnl: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  avgWinLossRatio: number;
  largestWin: number;
  largestLoss: number;
  avgTradePnl: number;
  avgMae: number;
}

/**
 * Complete journal data payload
 */
export interface JournalData {
  generatedAt: string;
  metrics: JournalMetrics;
  dailyStats: Record<string, DailyStats>;
  cumulativePnl: { date: string; pnl: number }[];
  positions: JournalPosition[];
}
