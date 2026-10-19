import { Database } from 'bun:sqlite';
import { getDB } from '../getDB';

export const enum PositionHistoryDBTables {
  POSITIONS = 'positions',
}

export async function getPositionHistoryDB(): Promise<Database> {
  const db = getDB('data/position_history.sqlite');
  db.run(`
    CREATE TABLE IF NOT EXISTS ${PositionHistoryDBTables.POSITIONS} (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      entry_price REAL NOT NULL,
      close_price REAL,
      quantity REAL NOT NULL,
      margin REAL NOT NULL,
      leverage INTEGER NOT NULL,
      open_timestamp INTEGER NOT NULL,
      close_timestamp INTEGER,
      enter_fee REAL,
      exit_fee REAL,
      unrealized_pnl REAL NOT NULL,
      realized_pnl REAL NOT NULL,
      mae REAL NOT NULL,
      min_realized_pnl REAL,
      max_realized_pnl REAL,
      closed_by_strategy TEXT,
      position_raw_json TEXT NOT NULL,
      bot_config_json TEXT NOT NULL
    );
  `);

  return db;
}

export function closePositionHistoryDB(db?: Database | null): void {
  if (!db) {
    return;
  }

  try {
    db.close();
  } catch {
    // Ignore close errors - connection may already be closed
  }
}
