import { FakeExchangeDBTables, getFakeExchangeDB } from './fakeExchangeDB';
import { closeFakeExchangeDB } from './fakeExchangeDB';

export async function updateFakeExchangeBalance(newBalance: number): Promise<void> {
  const db = await getFakeExchangeDB();

  const insertStatement = db.prepare(
    `INSERT OR REPLACE INTO ${FakeExchangeDBTables.STATE} (id, balance) VALUES (1, ?);`
  );

  insertStatement.run(newBalance);

  closeFakeExchangeDB();
}
