import type { JournalPosition } from '@/journal/types';
import { type PositionDBRow, transformDBRowToPosition } from '@/journal/utils/dataTransformer';
import {
  getPositionHistoryDB,
  PositionHistoryDBTables,
  closePositionHistoryDB,
} from './positionHistoryDB';

/**
 * Fetch all closed positions from the database
 */
export async function getAllPositionHistory(): Promise<JournalPosition[]> {
  const db = await getPositionHistoryDB();
  try {
    const rows = db
      .query<
        PositionDBRow,
        []
      >(`SELECT * FROM ${PositionHistoryDBTables.POSITIONS} ORDER BY close_timestamp ASC`)
      .all();

    return rows.map(transformDBRowToPosition);
  } finally {
    closePositionHistoryDB(db);
  }
}
