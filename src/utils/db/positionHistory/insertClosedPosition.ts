import type { ALXPosition } from '@/domain/ALXPosition';
import {
  closePositionHistoryDB,
  getPositionHistoryDB,
  PositionHistoryDBTables,
} from './positionHistoryDB';
import type { SerializedBotConfig } from '@/siobot/BotConfig';

export async function insertClosedPosition(
  position: ALXPosition,
  serializedBotConfig: SerializedBotConfig
): Promise<void> {
  const db = await getPositionHistoryDB();
  try {
    const insertStatement = db.prepare(`
      INSERT OR REPLACE INTO ${PositionHistoryDBTables.POSITIONS} (
        id,
        symbol,
        side,
        entry_price,
        close_price,
        quantity,
        margin,
        leverage,
        open_timestamp,
        close_timestamp,
        enter_fee,
        exit_fee,
        unrealized_pnl,
        realized_pnl,
        mae,
        min_realized_pnl,
        max_realized_pnl,
        closed_by_strategy,
        position_raw_json,
        bot_config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);

    insertStatement.run(
      position.id,
      position.symbol,
      position.side,
      position.entryPrice,
      position.closePrice ?? null,
      position.quantity,
      position.margin,
      position.leverage,
      position.openTimestamp,
      position.closeTimestamp ?? null,
      position.enterFee ?? null,
      position.exitFee ?? null,
      position.unrealizedPnl,
      position.realizedPnl,
      position.mae,
      position.minRealizedPnl ?? null,
      position.maxRealizedPnl ?? null,
      position.closedByStrategy?.strategyName ?? null,
      JSON.stringify(position),
      JSON.stringify(serializedBotConfig)
    );
  } finally {
    closePositionHistoryDB(db);
  }
}
