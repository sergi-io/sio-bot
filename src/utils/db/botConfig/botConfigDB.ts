import { Database } from 'bun:sqlite';
import { getDB } from '../getDB';

let botConfigDBInstance: Database | null = null;
let botConfigTablesInitialized = false;

export const enum BOTConfigDBTables {
  BOT_CONFIG = 'bot_config',
}

type BOTConfigRow = {
  paused: number;
};

export async function getBOTConfigDB(): Promise<Database> {
  if (botConfigDBInstance) {
    return botConfigDBInstance;
  }

  const db = getDB('data/bot_config.sqlite');
  botConfigDBInstance = db;

  if (!botConfigTablesInitialized) {
    db.run(`
      CREATE TABLE IF NOT EXISTS ${BOTConfigDBTables.BOT_CONFIG} (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        paused INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO ${BOTConfigDBTables.BOT_CONFIG} (id, paused, updated_at)
      VALUES (1, 0, ${Date.now()});
    `);

    botConfigTablesInitialized = true;
  }

  return db;
}

export async function getBotPaused(): Promise<boolean> {
  const db = await getBOTConfigDB();
  const row = db
    .prepare(`SELECT paused FROM ${BOTConfigDBTables.BOT_CONFIG} WHERE id = 1`)
    .get() as BOTConfigRow | null;

  return row?.paused === 1;
}

export async function setBotPaused(paused: boolean): Promise<void> {
  const db = await getBOTConfigDB();
  db.prepare(
    `
    INSERT INTO ${BOTConfigDBTables.BOT_CONFIG} (id, paused, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      paused = excluded.paused,
      updated_at = excluded.updated_at
  `
  ).run(paused ? 1 : 0, Date.now());
}

export function closeBOTConfigDB(): void {
  if (!botConfigDBInstance) {
    return;
  }

  try {
    botConfigDBInstance.close();
  } catch {
    // Ignore close errors - connection may already be closed
  }
  botConfigDBInstance = null;
  botConfigTablesInitialized = false;
}
