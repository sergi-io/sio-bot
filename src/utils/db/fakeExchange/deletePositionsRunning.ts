import { closeFakeExchangeDB, FakeExchangeDBTables, getFakeExchangeDB } from './fakeExchangeDB';

/**
 * Delete running positions from the database.
 * @param positionIds - Optional array of position IDs to delete. If not provided, deletes all running positions.
 * @returns Object containing the number of deleted positions.
 */
export async function deletePositionsRunning(positionIds?: string[]): Promise<{ deleted: number }> {
  const db = await getFakeExchangeDB();

  if (!positionIds || positionIds.length === 0) {
    // Delete all running positions
    const result = db.run(`DELETE FROM ${FakeExchangeDBTables.POSITIONS_RUNNING};`);
    closeFakeExchangeDB();
    return { deleted: result.changes };
  }

  // Delete specific positions using a transaction for efficiency
  const deleteStatement = db.prepare(
    `DELETE FROM ${FakeExchangeDBTables.POSITIONS_RUNNING} WHERE id = ?;`
  );

  const deleteMany = db.transaction((ids: string[]) => {
    for (const id of ids) {
      deleteStatement.run(id);
    }
  });

  deleteMany(positionIds);

  closeFakeExchangeDB();

  return { deleted: positionIds.length };
}
