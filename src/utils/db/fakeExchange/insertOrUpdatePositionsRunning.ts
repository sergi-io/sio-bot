import type { ALXPosition } from '@/domain/ALXPosition';
import { closeFakeExchangeDB, FakeExchangeDBTables, getFakeExchangeDB } from './fakeExchangeDB';

export async function insertOrUpdatePositionsRunning(
  positions: ALXPosition[]
): Promise<{ inserted: number }> {
  const db = await getFakeExchangeDB();

  const insertStatement = db.prepare(
    `INSERT OR REPLACE INTO ${FakeExchangeDBTables.POSITIONS_RUNNING} (id, position_raw_json) VALUES (?, ?);`
  );

  const insertMany = db.transaction((rows: ALXPosition[]) => {
    for (const row of rows) {
      insertStatement.run(row.id, JSON.stringify(row));
    }
  });

  insertMany(positions);

  closeFakeExchangeDB();

  return { inserted: positions.length };
}
