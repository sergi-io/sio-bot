import { config } from '@/config';
import { FakeExchange } from '../FakeExchange/FakeExchange';
import { getFakeExchangeBalance } from '@/utils/db/fakeExchange/getFakeExchangeBalance';
import { insertOrUpdatePositionsRunning } from '@/utils/db/fakeExchange/insertOrUpdatePositionsRunning';
import type { ALXOrder } from '@/domain/ALXOrder';
import type { ALXPosition } from '@/domain/ALXPosition';
import { deletePositionsRunning } from '@/utils/db/fakeExchange/deletePositionsRunning';
import { getPositionsRunning } from '@/utils/db/fakeExchange/getPositionsRunning';
import { updateFakeExchangeBalance } from '@/utils/db/fakeExchange/updateFakeExchangeBalance';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import { getKlinesHistoryLast } from '@/utils/getKlinesHistory';
import type { ALXKline } from '@/domain/ALXKline';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { logger } from '@/utils/logger';

/**
 * PaperTradeExchange - Main exchange interface for paper trading
 * This exchange is for testing real time trading strategies without risking real money.
 * Extends FakeExchange but it proxies klines subscription to phemex exchange
 * that way we get live market data while paper trading
 */

export class PaperTradeExchange extends FakeExchange {
  public override name: string = 'PaperTradeExchange';

  constructor() {
    super({ initialBalance: Number(config.paperTrade.initialBalance) });
  }

  public override async connect(): Promise<void> {
    try {
      await this.nexusClient.connect();
      logger.info('✅ Connected to SIO-Nexus socket');
    } catch (err) {
      logger.error(`Failed to connect to SIO-Nexus socket: ${err}`);
      throw err;
    }
  }

  public override async disconnect(): Promise<void> {
    try {
      this.nexusClient.disconnect();
      logger.info('✅ Disconnected from SIO-Nexus socket');
    } catch (err) {
      logger.error(`Failed to disconnect from SIO-Nexus socket: ${err}`);
      throw err;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override async syncBalance(_symbol: string): Promise<void> {
    const balance = await getFakeExchangeBalance();

    // Update BalanceManager with total balance from exchange
    this.balanceManager.updateTotalBalance(balance);

    // Sync locked margins from open positions
    await this.syncLockedMarginsFromPositions();
  }

  public override async warmUpKlinesBuffer(
    symbol: string,
    timeframes: ALXTimeFrame[],
    limit: number
  ): Promise<void> {
    await this.subscribeNexusSources(symbol);
    const klines = await getKlinesHistoryLast({
      symbol,
      timeframes,
      limit,
    });
    for (const kline of klines) {
      this.addKlinesToBuffer(kline.pair, kline.timeframe, [kline]);
    }
  }

  override async getOpenPositions(): Promise<ALXPosition[]> {
    const openDBPositions = await getPositionsRunning();
    this.openPositions = {};
    for (const position of openDBPositions) {
      this.openPositions[position.id] = position;
    }
    return openDBPositions;
  }

  public override async syncLockedMarginsFromPositions(): Promise<void> {
    const positions = await this.getOpenPositions();

    // Clear and rebuild locked margins (handles external positions)
    this.balanceManager.clearLockedMargins();

    for (const position of positions) {
      this.balanceManager.lockMargin(position.id, position.margin);
    }
  }

  override async openOrder(order: ALXOrder, isBackTest: boolean): Promise<void> {
    await super.openOrder(order, isBackTest);
    await insertOrUpdatePositionsRunning(Object.values(this.openPositions));
  }

  override async closePosition(corePosition: ALXPosition): Promise<ALXPosition> {
    const closedPosition = await super.closePosition(corePosition);
    await deletePositionsRunning([corePosition.id]);
    await updateFakeExchangeBalance(this.balanceManager.getTotalBalance());
    return closedPosition;
  }

  public override async subscribeKlines(
    symbol: string,
    timeframes: ALXTimeFrame[],
    onKlineReceived: (
      newKlines: ALXKline[],
      klinesBuffer: RollingWindowBuffer<ALXKline> | null
    ) => Promise<void>
  ): Promise<void> {
    logger.debug(
      `Subscribing to Nexus klines for ${symbol} at timeframes [${timeframes.join(',')}]`
    );

    await this.subscribeNexusSources(symbol);

    this.nexusClient.subscribe(symbol, timeframes, async (kline: ALXKline) => {
      const buffer = this.addOrUpdateRealtimeKlineToBuffer(kline);
      await onKlineReceived([kline], buffer);
    });
  }

  public override async unsubscribeKlines(
    symbol: string,
    timeframes: ALXTimeFrame[]
  ): Promise<void> {
    logger.debug(
      `Unsubscribing from Nexus klines for ${symbol} at timeframes [${timeframes.join(',')}]`
    );

    await this.unsubscribeNexusSources(symbol);
    this.nexusClient.unsubscribe(symbol, timeframes);
  }
}
