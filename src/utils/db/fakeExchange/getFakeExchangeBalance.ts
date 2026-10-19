import { FakeExchangeDBTables, getFakeExchangeDB } from './fakeExchangeDB';

export async function getFakeExchangeBalance(): Promise<number> {
  const db = await getFakeExchangeDB();

  const row = db.prepare(`SELECT balance FROM ${FakeExchangeDBTables.STATE} WHERE id = 1`).get() as
    | { balance: number }
    | undefined;

  if (!row) {
    throw new Error('FakeExchange balance not found in database');
  }

  return Number(row.balance);
}
