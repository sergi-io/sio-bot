import { BaseExchange } from './../BaseExchange';
import { ALXPositionSide } from '../../domain/ALXPosition';
import { ALXOrderSide, type ALXOrder } from '@/domain/ALXOrder';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import type { ALXKline } from '@/domain/ALXKline';
import type { ALXExchange, FeeRate } from '../../domain/ALXExchange';
import { config } from '@/config';
import { logger, silentLogger } from '@/utils/logger';
import type { ALXPosition } from '@/domain/ALXPosition';
import { nanoid } from 'nanoid';
import { getCurrentTimestampMs } from '@/utils/date';
import { BalanceManager } from '@/balance/BalanceManager';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { getKlinesHistoryRange } from '@/utils/getKlinesHistory';
import { ALXTimeFramesMsMap } from '@/domain/ALXTimeFrame';

type HistoricalDataRange = { startTimestampMs: number; endTimestampMs: number };

export type KlineHistoricalDataRange = {
  dateStart: number;
  dateEnd: number;
};

type FakeExchangeConstructorParams = {
  initialBalance: number;
  historicalKlines?: ALXKline[];
  klineHistoricalDataRange?: KlineHistoricalDataRange;
  silent?: boolean;
};

/**
 * FakeExchange - Main exchange interface
 */
export class FakeExchange extends BaseExchange implements ALXExchange {
  public override name: string = 'FakeExchange';
  protected historicalKlines: ALXKline[] = [];
  private slowMotionFactor: number = 0;
  protected openPositions: Record<string, ALXPosition> = {};
  private closedPositions: Record<string, ALXPosition> = {};
  protected cursor: number = 0;
  private logger: typeof logger = logger;
  private klineHistoricalDataRange: HistoricalDataRange = {
    startTimestampMs: 0,
    endTimestampMs: 0,
  };
  private readonly preloadedHistoricalKlines?: ALXKline[];
  private silent: boolean = false;

  constructor({
    initialBalance,
    historicalKlines,
    silent = false,
    klineHistoricalDataRange,
  }: FakeExchangeConstructorParams) {
    super();
    this.silent = silent;
    this.preloadedHistoricalKlines = historicalKlines;
    this.balanceManager = new BalanceManager(initialBalance);

    if (silent) {
      this.logger = silentLogger as typeof logger;
    }
    if (klineHistoricalDataRange) {
      this.klineHistoricalDataRange = {
        startTimestampMs: klineHistoricalDataRange.dateStart,
        endTimestampMs: klineHistoricalDataRange.dateEnd,
      };
    }
  }

  override async connect(): Promise<void> {}

  override async disconnect(): Promise<void> {}

  protected async _readHistoricalData(
    symbol: string,
    timeframes: ALXTimeFrame[],
    limit?: number
  ): Promise<void> {
    this.logger.debug('FakeExchange: (🔄 Importing historical data)...');
    if (this.preloadedHistoricalKlines) {
      const timeframeSet = new Set(timeframes);
      const filteredKlines = this.preloadedHistoricalKlines.filter(
        (kline) =>
          kline.pair === symbol &&
          timeframeSet.has(kline.timeframe) &&
          kline.timestamp >= this.klineHistoricalDataRange.startTimestampMs &&
          kline.timestamp <= this.klineHistoricalDataRange.endTimestampMs
      );

      this.historicalKlines =
        typeof limit === 'number' ? filteredKlines.slice(0, limit) : filteredKlines;
    } else {
      this.historicalKlines = await getKlinesHistoryRange({
        symbol,
        startTimestampMs: this.klineHistoricalDataRange.startTimestampMs,
        endTimestampMs: this.klineHistoricalDataRange.endTimestampMs,
        timeframes,
        limit,
        log: !this.silent,
      });
    }

    if (this.historicalKlines.length === 0) {
      console.error('FakeExchange: No historical klines found for the specified range.');
      process.exit(1);
    } else {
      this.logger.debug(
        `FakeExchange: Imported ${this.historicalKlines.length} historical klines successfully.`
      );
    }
  }

  async slowMotion(factor: number) {
    this.slowMotionFactor = factor;
  }

  async disableSlowMotion() {
    this.slowMotionFactor = 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async syncBalance(_symbol: string): Promise<void> {
    return;
  }

  /**
   * In FakeExchange opening orders means transitively creating positions
   * @param order
   */
  async openOrder(order: ALXOrder, isBackTest: boolean): Promise<void> {
    const positionSide =
      order.side === ALXOrderSide.BUY ? ALXPositionSide.LONG : ALXPositionSide.SHORT;

    // Check if there is enough available balance to open the position
    const availableBalance = this.balanceManager.getAvailableBalance();
    if (order.margin - 0.1 > availableBalance) {
      this.logger.error(
        `Insufficient balance to open position. Required: ${order.margin.toFixed(2)}, Available: ${availableBalance.toFixed(2)}`
      );
      return;
    }

    const leverage = this.getLeverageBySymbol(order.symbol);

    const position: ALXPosition = {
      id: nanoid(),
      symbol: order.symbol,
      quantity: order.quantity,
      leverage,
      margin: order.margin,
      entryPrice: order.price,
      unrealizedPnl: 0,
      realizedPnl: 0,
      mae: 0,
      openedByStrategies: order.openedByStrategies ?? [],
      riskStrategiesExecuted: order.riskStrategiesExecuted ?? [],
      openTimestamp: isBackTest ? order.openedTimestamp : getCurrentTimestampMs(),
      side: positionSide,
    };

    // If there is an existing position in the exchange, we need to aggregate it like exchanges does.
    const existingPosition = Object.values(this.openPositions).find(
      (pos) => pos.symbol === order.symbol && pos.side === positionSide
    );
    if (existingPosition) {
      const existingQuantity = existingPosition.quantity;
      const newQuantity = position.quantity;
      position.id = existingPosition.id;
      position.quantity = existingQuantity + newQuantity;
      position.margin += existingPosition.margin;
      // Recalculate entry price as weighted average
      position.entryPrice =
        (existingPosition.entryPrice * existingQuantity + position.entryPrice * newQuantity) /
        position.quantity;
      position.riskStrategiesExecuted = [
        ...(existingPosition.riskStrategiesExecuted ?? []),
        ...(position.riskStrategiesExecuted ?? []),
      ];
      position.openTimestamp = Math.min(existingPosition.openTimestamp, position.openTimestamp);
      position.openedByStrategies = [
        ...(existingPosition.openedByStrategies ?? []),
        ...(position.openedByStrategies ?? []),
      ];
    }

    // Lock margin BEFORE adding to openPositions
    this.balanceManager.lockMargin(position.id, order.margin);
    this.openPositions[position.id] = position;
  }

  async closePosition(corePosition: ALXPosition): Promise<ALXPosition> {
    const position = this.openPositions[corePosition.id];
    if (!position) {
      this.logger.error(`Error closing Position with ID ${corePosition.id} not found.`);
      return corePosition;
    }

    // Release margin and apply PnL to total balance
    this.balanceManager.releaseMargin(corePosition.id, corePosition.realizedPnl);

    // Move position to closed positions
    this.closedPositions[corePosition.id] = { ...corePosition };
    delete this.openPositions[corePosition.id];

    const newBalance = this.balanceManager.getTotalBalance();
    this.logger.info(
      `🚀 Realized PnL: ${corePosition.realizedPnl.toFixed(2)} USDT - New Balance: ${newBalance.toFixed(2)} USDT`
    );

    return this.closedPositions[corePosition.id]!;
  }

  async getClosedPosition(corePosition: ALXPosition): Promise<ALXPosition | null> {
    return this.closedPositions[corePosition.id] ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async cancelOrder(_orderID: string): Promise<void> {
    throw new Error('not implemented');
  }

  public override async subscribeKlines(
    symbol: string,
    timeframes: ALXTimeFrame[],
    // Klines are injected in the buffer before calling this callback
    // Beware that you can access the buffer directly if needed
    onKlineReceived: (
      newKlines: ALXKline[],
      klinesBuffer: RollingWindowBuffer<ALXKline> | null
    ) => Promise<void>
  ): Promise<void> {
    for (let i = this.cursor; i < this.historicalKlines.length; i++) {
      if (this.slowMotionFactor > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.slowMotionFactor * 1000));
      }
      const kline = this.historicalKlines[i];
      if (!kline) {
        this.logger.warn('FakeExchange: No more historical klines to process.');
        break;
      }
      this.addKlinesToBuffer(symbol, kline.timeframe, [kline]);
      const klinesBuffer = this.getKlinesBuffer(symbol, kline.timeframe) || null;
      await onKlineReceived([kline], klinesBuffer);
      this.cursor++;
    }
  }

  /**
   * Unsubscribe from klines
   */
  public override async unsubscribeKlines(
    symbol: string,
    timeframes: ALXTimeFrame[]
  ): Promise<void> {
    void symbol;
    void timeframes;
    return;
  }

  override async warmUpKlinesBuffer(
    symbol: string,
    timeframes: ALXTimeFrame[],
    limit: number
  ): Promise<void> {
    await this._readHistoricalData(symbol, timeframes);

    const lowerTimeframe = [...timeframes].sort(
      (left, right) => ALXTimeFramesMsMap[left] - ALXTimeFramesMsMap[right]
    )[0];
    if (!lowerTimeframe) {
      console.error('FakeExchange: No timeframe available to warm up buffers.');
      process.exit(1);
    }

    const historicalLowerTimeframe = this.historicalKlines.filter(
      (k) => k.timeframe === lowerTimeframe
    );

    const warmUpBoundaryTimestamp =
      historicalLowerTimeframe[Math.min(limit, historicalLowerTimeframe.length) - 1]?.timestamp;
    const indexOnHistorical = this.historicalKlines.findLastIndex(
      (k) => k.timestamp === warmUpBoundaryTimestamp
    );
    if (indexOnHistorical === -1) {
      console.error(
        `FakeExchange: Could not find the warm-up boundary for timeframe ${lowerTimeframe}. Cannot warm up buffer.`
      );
      process.exit(1);
    }

    const warmUpBoundaryIndex = indexOnHistorical + 1;
    this.cursor = warmUpBoundaryIndex;
    const warmUpKlines = this.historicalKlines.slice(0, warmUpBoundaryIndex);
    for (const kline of warmUpKlines) {
      this.addKlinesToBuffer(kline.pair, kline.timeframe, [kline]);
    }
  }

  public override async getOpenPositions(): Promise<ALXPosition[]> {
    return Object.values(this.openPositions);
  }

  public getHistoricalKlines(): ALXKline[] {
    return this.historicalKlines;
  }

  public async syncFeeRates(): Promise<void> {
    // In a real exchange, this would fetch from an API
    this.logger.info('FakeExchange: syncFeeRates called (no-op in FakeExchange).');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getFeeRateBySymbol(symbol: string): FeeRate {
    const defaultFeeRate: FeeRate = { ...config.defaults.fees };
    return defaultFeeRate;
  }
}
