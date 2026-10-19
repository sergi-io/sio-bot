import type { JournalData, JournalPosition } from '../types';
import { calculateCumulativePnl, calculateMetrics, groupByDay } from './metrics';

/**
 * Database row structure from position_history table
 */
export interface PositionDBRow {
  id: string;
  symbol: string;
  side: string;
  entry_price: number;
  close_price: number | null;
  quantity: number;
  margin: number;
  leverage: number;
  open_timestamp: number;
  close_timestamp: number | null;
  enter_fee: number | null;
  exit_fee: number | null;
  unrealized_pnl: number;
  realized_pnl: number;
  mae: number;
  min_realized_pnl: number | null;
  max_realized_pnl: number | null;
  closed_by_strategy: string | null;
  position_raw_json: string;
  bot_config_json: string;
}

/**
 * Extract the first enter strategy name from position raw JSON
 */
function extractOpenedByStrategies(positionRawJson: string): string {
  try {
    const position = JSON.parse(positionRawJson);
    if (position.openedByStrategies && position.openedByStrategies.length > 0) {
      return position.openedByStrategies.map((s: any) => s.strategyName).join(', ');
    }
  } catch {
    // Ignore parse errors
  }
  return 'Unknown';
}

/**
 * Transform a database row to a JournalPosition
 */
export function transformDBRowToPosition(row: PositionDBRow): JournalPosition {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side as 'long' | 'short',
    entryPrice: row.entry_price,
    closePrice: row.close_price ?? 0,
    quantity: row.quantity,
    margin: row.margin,
    leverage: row.leverage,
    openTimestamp: row.open_timestamp,
    closeTimestamp: row.close_timestamp ?? 0,
    enterFee: row.enter_fee ?? 0,
    exitFee: row.exit_fee ?? 0,
    realizedPnl: row.realized_pnl,
    mae: row.mae,
    minPnl: row.min_realized_pnl ?? 0,
    maxPnl: row.max_realized_pnl ?? 0,
    openedByStrategies: extractOpenedByStrategies(row.position_raw_json),
    closedByStrategy: row.closed_by_strategy ?? 'Unknown',
    botConfigJson: row.bot_config_json,
  };
}

/**
 * Build complete JournalData object from positions
 */
export function buildJournalData(positions: JournalPosition[]): JournalData {
  const metrics = calculateMetrics(positions);
  const dailyStats = groupByDay(positions);
  const cumulativePnl = calculateCumulativePnl(dailyStats);

  return {
    generatedAt: new Date().toISOString(),
    metrics,
    dailyStats,
    cumulativePnl,
    positions,
  };
}
