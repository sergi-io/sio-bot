import type { ALXKline } from '@/domain/ALXKline';
import { NexusAggrSocketClient } from './NexusAggrSocketClient';
import { BalanceManager } from '@/balance/BalanceManager';
import { logger } from '@/utils/logger';
import type { ALXPosition } from '@/domain/ALXPosition';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { config } from '@/config';
import { getKlinesHistoryLast } from '@/utils/getKlinesHistory';
import {
  NexusControlSocketClient,
  type NexusControlSubscribeRequest,
  type NexusControlUnsubscribeRequest,
} from './NexusControlSocketClient';

export class BaseExchange {
  public name: string = 'BaseExchange';
  public balanceManager: BalanceManager;
  protected nexusClient: NexusAggrSocketClient;
  protected nexusControlClient: NexusControlSocketClient;
  //.                         symbol     timeframe       Rolling Buffer - klines
  protected klinesBuffer: Map<string, Map<string, RollingWindowBuffer<ALXKline>>> = new Map();
  protected leveragesBySymbol: Map<string, number> = new Map();
  private readonly nexusControlSubscribedSymbols = new Set<string>();

  constructor() {
    this.balanceManager = new BalanceManager();
    this.nexusClient = new NexusAggrSocketClient();
    this.nexusControlClient = new NexusControlSocketClient();
  }

  public async connect(): Promise<void> {
    try {
      await this.nexusClient.connect();
      logger.info('✅ Connected to SIO-Nexus socket');
    } catch (err) {
      logger.error(`Failed to connect to SIO-Nexus socket: ${err}`);
      throw err;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      this.nexusClient.disconnect();
      logger.info('✅ Disconnected from SIO-Nexus socket');
    } catch (err) {
      logger.error(`Failed to disconnect from SIO-Nexus socket: ${err}`);
      throw err;
    }
  }

  public async getOpenPositions(): Promise<ALXPosition[]> {
    // This method should be implemented by subclasses
    throw new Error('getOpenPositions method not implemented');
  }

  protected async syncLockedMarginsFromPositions(): Promise<void> {
    const positions = await this.getOpenPositions();

    // Clear and rebuild locked margins (handles external positions)
    this.balanceManager.clearLockedMargins();

    for (const position of positions) {
      this.balanceManager.lockMargin(position.id, position.margin);
    }
  }

  public async getBalance(): Promise<number> {
    return this.balanceManager.getTotalBalance();
  }

  public getKlinesBuffer(symbol: string, timeframe: string): RollingWindowBuffer<ALXKline> | null {
    const buffer = this.klinesBuffer.get(symbol);
    if (!buffer) {
      return null;
    }
    return buffer.get(timeframe) || null;
  }

  public async setLeverageBySymbol(symbol: string, leverage: number): Promise<void> {
    this.leveragesBySymbol.set(symbol, leverage);
  }

  public getLeverageBySymbol(symbol: string): number {
    return this.leveragesBySymbol.get(symbol) || 1;
  }

  public getCurrentPrice(symbol: string, timeframe: ALXTimeFrame): number | null {
    const lastKline = this.getKlinesBuffer(symbol, timeframe)?.getLast();
    if (lastKline) {
      return lastKline.close;
    }
    return null;
  }

  async warmUpKlinesBuffer(
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

  public addKlinesToBuffer(symbol: string, timeframe: ALXTimeFrame, Klines: ALXKline[]): void {
    // Retrieve buffer for symbol and timeframe, or create it if it doesn't exist
    if (!this.klinesBuffer.has(symbol)) {
      this.klinesBuffer.set(symbol, new Map());
    }
    const timeframeBuffers = this.klinesBuffer.get(symbol)!;

    if (!timeframeBuffers.has(timeframe)) {
      timeframeBuffers.set(
        timeframe,
        new RollingWindowBuffer<ALXKline>(config.defaults.buffer.size)
      );
    }

    const _klineBuffer = timeframeBuffers.get(timeframe)!;
    for (const kline of Klines) {
      _klineBuffer.push(kline);
    }
  }

  protected addOrUpdateRealtimeKlineToBuffer(kline: ALXKline): RollingWindowBuffer<ALXKline> {
    if (!this.klinesBuffer.has(kline.pair)) {
      this.klinesBuffer.set(kline.pair, new Map());
    }

    const timeframeBuffers = this.klinesBuffer.get(kline.pair)!;
    if (!timeframeBuffers.has(kline.timeframe)) {
      timeframeBuffers.set(
        kline.timeframe,
        new RollingWindowBuffer<ALXKline>(config.defaults.buffer.size)
      );
    }

    const klineBuffer = timeframeBuffers.get(kline.timeframe)!;
    const lastKline = klineBuffer.getLast();

    if (lastKline && kline.timestamp < lastKline.timestamp) {
      logger.warn(
        `Ignoring stale realtime kline for ${kline.pair}:${kline.timeframe}. ` +
          `incoming=${kline.timestamp}, latest=${lastKline.timestamp}`
      );
      return klineBuffer;
    }

    if (lastKline && kline.timestamp === lastKline.timestamp) {
      // Realtime updates for the current candle must replace, not append.
      klineBuffer.pop();
    }

    klineBuffer.push(kline);
    return klineBuffer;
  }

  async unsubscribeKlines(symbol: string, timeframes: ALXTimeFrame[]): Promise<void> {
    await this.unsubscribeNexusSources(symbol);
    this.nexusClient.unsubscribe(symbol, timeframes);
  }

  protected async subscribeNexusSources(symbol: string): Promise<void> {
    if (this.nexusControlSubscribedSymbols.has(symbol)) {
      return;
    }

    await this.nexusControlClient.subscribe(this.getNexusControlSubscribeRequests(symbol));
    this.nexusControlSubscribedSymbols.add(symbol);
  }

  protected getNexusControlSubscribeRequests(symbol: string): NexusControlSubscribeRequest[] {
    const spotSymbol = this.formatNexusSpotSymbol(symbol);
    const futuresSymbol = `${spotSymbol}:USDT`;

    return [
      // {
      //   action: 'subscribe',
      //   pair: symbol,
      //   exchangeId: 'binance',
      //   symbol: spotSymbol,
      //   persistToDb: false,
      // },
      // {
      //   action: 'subscribe',
      //   pair: symbol,
      //   exchangeId: 'binanceusdm',
      //   symbol: futuresSymbol,
      //   persistToDb: false,
      //   mainPriceTracker: true,
      // },
      {
        action: 'subscribe',
        pair: symbol,
        exchangeId: 'bitget',
        symbol: futuresSymbol,
        persistToDb: false,
        mainPriceTracker: true,
      },
    ];
  }

  protected async unsubscribeNexusSources(symbol: string): Promise<void> {
    if (!this.nexusControlSubscribedSymbols.has(symbol)) {
      return;
    }

    await this.nexusControlClient.unsubscribe(this.getNexusControlUnsubscribeRequests(symbol));
    this.nexusControlSubscribedSymbols.delete(symbol);
  }

  protected getNexusControlUnsubscribeRequests(symbol: string): NexusControlUnsubscribeRequest[] {
    return this.getNexusControlSubscribeRequests(symbol).map((request) => ({
      action: 'unsubscribe',
      pair: request.pair,
      exchangeId: request.exchangeId,
      symbol: request.symbol,
    }));
  }

  private formatNexusSpotSymbol(pair: string): string {
    const knownQuotes = ['USDT', 'USDC', 'USD', 'BTC', 'ETH'];
    const quote = knownQuotes.find((candidate) => pair.endsWith(candidate));

    if (!quote) {
      return pair;
    }

    const base = pair.slice(0, -quote.length);
    return `${base}/${quote}`;
  }

  public async subscribeKlines(
    symbol: string,
    timeframes: ALXTimeFrame[],
    onKlineReceived: (
      newKlines: ALXKline[],
      klinesBuffer: RollingWindowBuffer<ALXKline> | null
    ) => Promise<void>
  ): Promise<void> {
    logger.debug(
      `Subscribing to Nexus klines for ${symbol} at timeframes: [${timeframes.join(',')}]`
    );

    await this.subscribeNexusSources(symbol);

    this.nexusClient.subscribe(symbol, timeframes, async (kline: ALXKline) => {
      this.addOrUpdateRealtimeKlineToBuffer(kline);
      await onKlineReceived([kline], this.getKlinesBuffer(kline.pair, kline.timeframe));
    });
  }
}
