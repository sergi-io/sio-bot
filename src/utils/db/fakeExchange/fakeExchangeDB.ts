import { Database } from 'bun:sqlite';
import { getDB } from '../getDB';
import { config } from '@/config';

// Singleton instance for the klines database connection.
// This prevents repeated open/close cycles that cause SQLite concurrency issues
// when multiple workers access the same database file.
let fakeExchangeDBInstance: Database | null = null;
let fakeExchangeTablesInitialized = false;

export const enum FakeExchangeDBTables {
  POSITIONS_RUNNING = 'positions_running',
  STATE = 'state',
}

export async function getFakeExchangeDB(): Promise<Database> {
  // Return existing connection if available and still open
  if (fakeExchangeDBInstance) {
    return fakeExchangeDBInstance;
  }

  const db = getDB('data/fake_exchange.sqlite');
  fakeExchangeDBInstance = db;

  if (!fakeExchangeTablesInitialized) {
    // Create table once per process to avoid schema-change locks on every access
    db.run(
      `
      CREATE TABLE IF NOT EXISTS ${FakeExchangeDBTables.POSITIONS_RUNNING} (
        id TEXT PRIMARY KEY,
        position_raw_json TEXT
      );

      CREATE TABLE IF NOT EXISTS ${FakeExchangeDBTables.STATE} (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        balance REAL NOT NULL
      );

      INSERT OR IGNORE INTO ${FakeExchangeDBTables.STATE} (id, balance)
      VALUES (1, ${config.paperTrade.initialBalance});
    `
    );

    fakeExchangeTablesInitialized = true;
  }

  return db;
}

/**
 * Explicitly close the fake exchange database connection.
 * Should only be called during process shutdown or when the connection is no longer needed.
 */
export function closeFakeExchangeDB(): void {
  if (fakeExchangeDBInstance) {
    try {
      fakeExchangeDBInstance.close();
    } catch {
      // Ignore close errors - connection may already be closed
    }
    fakeExchangeDBInstance = null;
    fakeExchangeTablesInitialized = false;
  }
}
