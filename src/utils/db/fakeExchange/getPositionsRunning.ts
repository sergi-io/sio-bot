import type { ALXPosition } from '@/domain/ALXPosition';
import { FakeExchangeDBTables, getFakeExchangeDB } from './fakeExchangeDB';

export async function getPositionsRunning(): Promise<ALXPosition[]> {
  const db = await getFakeExchangeDB();

  const rows = db
    .prepare(`SELECT position_raw_json FROM ${FakeExchangeDBTables.POSITIONS_RUNNING}`)
    .all() as Array<{ position_raw_json: string }>;

  return rows.map((row) => JSON.parse(row.position_raw_json) as ALXPosition);
}
