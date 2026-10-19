import {
  ALXOrderLimitType,
  ALXOrderSide,
  ALXOrderType,
  type ALXOrder,
} from '@/domain/ALXOrder';
import ccxt, { bitget, type Position, type TradingFees } from 'ccxt';
import type { ALXExchange, ClosePositionOptions, FeeRate } from '@/domain/ALXExchange';
import { logger } from '@/utils/logger';
import { config } from '@/config';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { normalizeSymbolString } from '@/utils/symbols';
import { BaseExchange } from '../BaseExchange';

type BitgetExchangeConstructorParams = {
  apiKey: string;
  secret: string;
  password: string;
  enableTestnet?: boolean;
};

const BITGET_PRODUCT_TYPE = 'USDT-FUTURES';
const BITGET_MARGIN_COIN = 'USDT';
const CLOSED_POSITION_LOOKUP_RETRIES = 10;
const CLOSED_POSITION_LOOKUP_DELAY_MS = 1_000;
type BitgetOrderType = 'market' | 'limit';
type BitgetOrderSide = 'buy' | 'sell';

export class BitgetExchange extends BaseExchange implements ALXExchange {
  public override name: string = 'Bitget';
  private readonly ccxtBitgetInstance: bitget;
  private feeRatesBySymbol: Map<string, FeeRate> = new Map();

  constructor({
    apiKey,
    secret,
    password,
    enableTestnet = false,
  }: BitgetExchangeConstructorParams) {
    super();
    this.ccxtBitgetInstance = new ccxt.bitget({
      apiKey,
      secret,
      password,
      enableRateLimit: true,
      options: {
        defaultType: 'swap',
        defaultSubType: 'linear',
        broker: '',
        builderFee: false,
      },
    });

    if (enableTestnet) {
      this.ccxtBitgetInstance.setSandboxMode(true);
    }
  }

  public override async connect(): Promise<void> {
    await super.connect();
    try {
      await this.ccxtBitgetInstance.loadMarkets();
      logger.info('✅ Loaded Markets from Bitget API');
      await this.syncPositionMode();
    } catch (err) {
      logger.error(`Failed to connect to Bitget API: ${err}`);
      throw err;
    }
  }

  public async syncBalance(symbol: string): Promise<void> {
    const code = symbol.toUpperCase();
    const balances = await this.ccxtBitgetInstance.fetchBalance({
      productType: BITGET_PRODUCT_TYPE,
    });

    const totalByCode = balances.total as Record<string, number | undefined> | undefined;
    const accountByCode = balances[code] as { total?: number } | undefined;
    const totalBalance = totalByCode?.[code] ?? accountByCode?.total ?? 0;

    this.balanceManager.updateTotalBalance(totalBalance);
    await this.syncLockedMarginsFromPositions();
  }

  public override async setLeverageBySymbol(symbol: string, leverage: number): Promise<void> {
    await super.setLeverageBySymbol(symbol, leverage);
    const ccxtSymbol = await this.resolveCcxtSymbol(symbol);
    await this.ccxtBitgetInstance.setLeverage(leverage, ccxtSymbol, {
      productType: BITGET_PRODUCT_TYPE,
    });
  }

  public async openOrder(order: ALXOrder, isBackTest: boolean): Promise<void> {
    if (isBackTest) {
      logger.debug('Skipping real Bitget order placement in backtest mode.');
      return;
    }

    const ccxtSymbol = await this.resolveCcxtSymbol(order.symbol);
    const side = this.toBitgetOrderSide(order.side);
    const type = this.toBitgetOrderType(order.type);
    const price = this.getOrderPrice(order, type);
    const params: Record<string, unknown> = {
      clientOrderId: order.id,
      marginCoin: BITGET_MARGIN_COIN,
      productType: BITGET_PRODUCT_TYPE,
      reduceOnly: false,
      oneWayMode: true,
    };

    this.applyLimitOrderParams(order, type, params);

    if (order.stopLossPrice !== undefined) {
      params.stopLoss = { triggerPrice: order.stopLossPrice };
    }
    if (order.takeProfitPrice !== undefined) {
      params.takeProfit = { triggerPrice: order.takeProfitPrice, price: order.takeProfitPrice };
    }

    try {
      await this.ccxtBitgetInstance.createOrder(
        ccxtSymbol,
        type,
        side,
        order.quantity,
        price,
        params
      );
    } catch (err) {
      logger.error(
        `Failed to open Bitget ${type.toUpperCase()} order for ${ccxtSymbol}: ${err}`
      );
      throw err;
    }

    logger.info(
      `Bitget order placed: ${type.toUpperCase()} ${side.toUpperCase()} ${ccxtSymbol} qty=${order.quantity} price=${price ?? 'MARKET'} limitType=${order.limitType ?? 'NONE'} stopLoss=${order.stopLossPrice ?? 'NONE'} takeProfit=${order.takeProfitPrice ?? 'NONE'}`
    );
  }

  public async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.ccxtBitgetInstance.cancelOrder(orderId);
      logger.info(`Bitget order cancelled: ${orderId}`);
    } catch (err) {
      logger.error(`Failed to cancel Bitget order ${orderId}: ${err}`);
      throw err;
    }
  }

  public async closePosition(
    alxPosition: ALXPosition,
    options: ClosePositionOptions = {}
  ): Promise<ALXPosition> {
    try {
      const ccxtSymbol = await this.resolveCcxtSymbol(alxPosition.symbol);
      const side = alxPosition.side === ALXPositionSide.LONG ? 'sell' : 'buy';
      const type = this.toBitgetOrderType(options.orderType ?? ALXOrderType.MARKET);
      const price = this.getClosePositionOrderPrice(alxPosition, type, options.price);
      const params: Record<string, unknown> = {
        marginCoin: BITGET_MARGIN_COIN,
        productType: BITGET_PRODUCT_TYPE,
        reduceOnly: true,
        oneWayMode: true,
      };

      this.applyLimitOrderParams(
        {
          id: alxPosition.id,
          symbol: alxPosition.symbol,
          margin: alxPosition.margin,
          quantity: alxPosition.quantity,
          price: price ?? alxPosition.closePrice ?? alxPosition.entryPrice,
          leverage: alxPosition.leverage,
          side: alxPosition.side === ALXPositionSide.LONG ? ALXOrderSide.SELL : ALXOrderSide.BUY,
          type: options.orderType ?? ALXOrderType.MARKET,
          limitType: options.limitType,
          openedTimestamp: alxPosition.openTimestamp,
        },
        type,
        params
      );

      await this.ccxtBitgetInstance.createOrder(
        ccxtSymbol,
        type,
        side,
        alxPosition.quantity,
        price,
        params
      );

      const exchangeClosedPosition = await this.waitForClosedPosition(alxPosition);
      if (!exchangeClosedPosition) {
        throw new Error(
          `Bitget: close order was sent for ${alxPosition.id}, but the closed position history was not available yet.`
        );
      }

      this.balanceManager.releaseMargin(alxPosition.id, exchangeClosedPosition.realizedPnl);

      logger.info(
        `Bitget: close ${type.toUpperCase()} order filled for position ${alxPosition.id} (${alxPosition.side} -> ${side}) on ${ccxtSymbol} qty=${alxPosition.quantity} price=${price ?? 'MARKET'} limitType=${options.limitType ?? 'NONE'} realizedPnl=${exchangeClosedPosition.realizedPnl}`
      );
      await this.syncBalance(BITGET_MARGIN_COIN);
      return exchangeClosedPosition;
    } catch (err) {
      logger.error(`Failed to close position ${alxPosition.id} on Bitget: ${err}`);
      throw err;
    }
  }

  public override async getOpenPositions(): Promise<ALXPosition[]> {
    try {
      const positions = await this.ccxtBitgetInstance.fetchPositions(undefined, {
        productType: BITGET_PRODUCT_TYPE,
        marginCoin: BITGET_MARGIN_COIN,
      });

      const openPositions = positions
        .filter((position) => Math.abs(this.getPositionQuantity(position)) > 0)
        .map((position) => this.mapPosition(position));

      logger.info(`Fetched ${openPositions.length} open positions from Bitget.`);

      if (openPositions.length > 0) {
        console.table(openPositions);
      }

      return openPositions;
    } catch (err) {
      logger.error(`Failed to fetch open positions from Bitget: ${err}`);
      return [];
    }
  }

  public async getClosedPosition(alxPosition: ALXPosition): Promise<ALXPosition | null> {
    try {
      const ccxtSymbol = await this.resolveCcxtSymbol(alxPosition.symbol);
      const since = Math.max(0, alxPosition.openTimestamp - 5 * 60 * 1000);
      const positions = await this.ccxtBitgetInstance.fetchPositionsHistory(
        [ccxtSymbol],
        since,
        20,
        {
          productType: BITGET_PRODUCT_TYPE,
          until: Date.now() + 60_000,
        }
      );
      const normalizedSymbol = normalizeSymbolString(alxPosition.symbol);
      const matchingPositions = positions
        .filter((position) => {
          const positionSymbol = normalizeSymbolString(position.symbol ?? '');
          const positionSide = this.resolvePositionSide(position);
          const updatedAt = position.lastUpdateTimestamp ?? position.timestamp ?? 0;

          return (
            positionSymbol === normalizedSymbol &&
            positionSide === alxPosition.side &&
            updatedAt >= since
          );
        })
        .sort((left, right) => {
          const leftTimestamp = left.lastUpdateTimestamp ?? left.timestamp ?? 0;
          const rightTimestamp = right.lastUpdateTimestamp ?? right.timestamp ?? 0;
          return rightTimestamp - leftTimestamp;
        });

      const exchangePosition = matchingPositions[0];
      if (!exchangePosition) {
        return null;
      }

      return this.mapClosedPosition(exchangePosition, alxPosition);
    } catch (err) {
      logger.error(`Failed to fetch closed Bitget position ${alxPosition.id}: ${err}`);
      return null;
    }
  }

  public async syncFeeRates(): Promise<void> {
    logger.info('Syncing fee rates from Bitget...');

    try {
      const fees = await this.ccxtBitgetInstance.fetchTradingFees({
        type: 'swap',
      });
      this.feeRatesBySymbol = this.mapTradingFees(fees);
      logger.info('✅ Fee rates synced from Bitget.');
    } catch (err) {
      logger.warn(`Failed to sync fee rates from Bitget, using defaults: ${err}`);
    }
  }

  public getFeeRateBySymbol(symbol: string): FeeRate {
    const normalizedSymbol = normalizeSymbolString(symbol);
    return (
      (normalizedSymbol ? this.feeRatesBySymbol.get(normalizedSymbol) : undefined) ?? {
        ...config.defaults.fees,
      }
    );
  }

  private async resolveCcxtSymbol(symbol: string): Promise<string> {
    if (!this.ccxtBitgetInstance.markets || !Object.keys(this.ccxtBitgetInstance.markets).length) {
      await this.ccxtBitgetInstance.loadMarkets();
    }

    const exactMarket = this.ccxtBitgetInstance.markets[symbol];
    if (exactMarket?.swap || exactMarket?.future) {
      return symbol;
    }

    const normalizedTargetSymbol = normalizeSymbolString(symbol);
    const market = Object.values(this.ccxtBitgetInstance.markets).find((candidate) => {
      if (!candidate.swap && !candidate.future) {
        return false;
      }

      const candidateSymbol = normalizeSymbolString(candidate.symbol);
      const candidateId = normalizeSymbolString(candidate.id ?? '');
      return candidateSymbol === normalizedTargetSymbol || candidateId === normalizedTargetSymbol;
    });

    if (!market) {
      throw new Error(`Bitget: market not found for symbol ${symbol}`);
    }

    return market.symbol;
  }

  private async syncPositionMode(): Promise<void> {
    try {
      await this.ccxtBitgetInstance.setPositionMode(false, undefined, {
        productType: BITGET_PRODUCT_TYPE,
      });
      logger.info('✅ Bitget position mode synced to one_way_mode.');
    } catch (err) {
      const message = String(err);
      if (message.includes('No need to change position mode')) {
        logger.info('✅ Bitget position mode already set to one_way_mode.');
        return;
      }

      logger.error(`Failed to set Bitget position mode to one_way_mode: ${err}`);
      throw err;
    }
  }

  private toBitgetOrderSide(side: ALXOrderSide): BitgetOrderSide {
    switch (side) {
      case ALXOrderSide.BUY:
        return 'buy';
      case ALXOrderSide.SELL:
        return 'sell';
    }
  }

  private toBitgetOrderType(type: ALXOrderType): BitgetOrderType {
    switch (type) {
      case ALXOrderType.MARKET:
        return 'market';
      case ALXOrderType.LIMIT:
        return 'limit';
    }
  }

  private getOrderPrice(order: ALXOrder, type: BitgetOrderType): number | undefined {
    if (type === 'market') {
      return undefined;
    }

    if (!Number.isFinite(order.price) || order.price <= 0) {
      throw new Error(
        `Bitget limit order for ${order.symbol} requires a positive finite price. Received: ${order.price}`
      );
    }

    return order.price;
  }

  private getClosePositionOrderPrice(
    position: ALXPosition,
    type: BitgetOrderType,
    price: number | undefined
  ): number | undefined {
    if (type === 'market') {
      return undefined;
    }

    if (price === undefined || !Number.isFinite(price) || price <= 0) {
      throw new Error(
        `Bitget limit close for ${position.symbol} requires a positive finite price. Received: ${price}`
      );
    }

    return price;
  }

  private applyLimitOrderParams(
    order: ALXOrder,
    type: BitgetOrderType,
    params: Record<string, unknown>
  ): void {
    if (type !== 'limit') {
      if (order.limitType !== undefined) {
        throw new Error(`Bitget limitType for ${order.symbol} can only be used with limit orders.`);
      }
      return;
    }

    switch (order.limitType ?? ALXOrderLimitType.GTC) {
      case ALXOrderLimitType.GTC:
        params.timeInForce = 'GTC';
        return;
      case ALXOrderLimitType.POST_ONLY:
        params.postOnly = true;
        return;
    }
  }

  private mapPosition(position: Position): ALXPosition {
    const symbol = normalizeSymbolString(position.symbol ?? String(position.info?.symbol ?? ''));
    if (!symbol) {
      throw new Error('Cannot normalize symbol string from Bitget position');
    }

    const quantity = this.getPositionQuantity(position);
    const entryPrice = position.entryPrice ?? this.readNumber(position.info?.openPrice, 0);
    const leverage = position.leverage ?? this.readNumber(position.info?.leverage, 0);
    const notional = position.notional ?? (entryPrice && quantity ? entryPrice * quantity : 0);
    const margin = position.initialMargin ?? this.readNumber(position.info?.marginSize, 0);
    const side = this.resolvePositionSide(position);
    const openTimestamp =
      position.timestamp ??
      this.readNumber(
        position.info?.cTime,
        this.readNumber(position.info?.createdTime, Date.now())
      );
    const unrealizedPnl = position.unrealizedPnl ?? this.readNumber(position.info?.unrealizedPL, 0);
    const realizedPnl = position.realizedPnl ?? this.readNumber(position.info?.achievedProfits, 0);
    const id = position.id ?? `${symbol}-${side}-${openTimestamp}`;

    return {
      id,
      symbol,
      side,
      entryPrice,
      quantity,
      margin: margin || (leverage ? notional / leverage : 0),
      leverage: leverage || this.getLeverageBySymbol(symbol),
      openTimestamp,
      unrealizedPnl,
      realizedPnl,
      mae: 0,
    };
  }

  private mapClosedPosition(position: Position, memoryPosition: ALXPosition): ALXPosition {
    const mappedPosition = this.mapPosition(position);
    const info = position.info ?? {};
    const netProfit = this.readNumber(info.netProfit, Number.NaN);
    const realizedPnl = Number.isFinite(netProfit) ? netProfit : mappedPosition.realizedPnl;
    const openFee = this.readAbsNumber(
      info.openFee ?? info.openFeeTotal,
      memoryPosition.enterFee ?? 0
    );
    const closeFee = this.readAbsNumber(
      info.closeFee ?? info.closeFeeTotal,
      memoryPosition.exitFee ?? 0
    );

    return {
      ...mappedPosition,
      id: memoryPosition.id,
      symbol: memoryPosition.symbol,
      side: memoryPosition.side,
      margin: memoryPosition.margin,
      leverage: memoryPosition.leverage,
      openTimestamp: memoryPosition.openTimestamp,
      closeTimestamp: position.lastUpdateTimestamp ?? position.timestamp ?? Date.now(),
      closePrice: position.lastPrice ?? memoryPosition.closePrice,
      enterFee: openFee,
      exitFee: closeFee,
      unrealizedPnl: 0,
      realizedPnl,
      mae: memoryPosition.mae,
      minRealizedPnl: memoryPosition.minRealizedPnl,
      maxRealizedPnl: memoryPosition.maxRealizedPnl,
    };
  }

  private async waitForClosedPosition(alxPosition: ALXPosition): Promise<ALXPosition | null> {
    for (let attempt = 1; attempt <= CLOSED_POSITION_LOOKUP_RETRIES; attempt++) {
      const closedPosition = await this.getClosedPosition(alxPosition);
      if (closedPosition) {
        return closedPosition;
      }

      await new Promise((resolve) => setTimeout(resolve, CLOSED_POSITION_LOOKUP_DELAY_MS));
    }

    return null;
  }

  private getPositionQuantity(position: Position): number {
    return Math.abs(
      position.contracts ??
        this.readNumber(position.info?.total, this.readNumber(position.info?.available, 0))
    );
  }

  private resolvePositionSide(position: Position): ALXPositionSide {
    const rawSide = position.side ?? String(position.info?.holdSide ?? '');
    return rawSide === 'short' ? ALXPositionSide.SHORT : ALXPositionSide.LONG;
  }

  private mapTradingFees(fees: TradingFees): Map<string, FeeRate> {
    const feeRatesBySymbol = new Map<string, FeeRate>();

    for (const [symbol, fee] of Object.entries(fees)) {
      const normalizedSymbol = normalizeSymbolString(symbol);
      if (!normalizedSymbol || !fee) {
        continue;
      }

      feeRatesBySymbol.set(normalizedSymbol, {
        makerRate: this.readNumber(fee.maker, config.defaults.fees.makerRate / 100) * 100,
        takerRate: this.readNumber(fee.taker, config.defaults.fees.takerRate / 100) * 100,
        fundingRate: config.defaults.fees.fundingRate,
      });
    }

    return feeRatesBySymbol;
  }

  private readNumber(value: unknown, fallback: number): number {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  }

  private readAbsNumber(value: unknown, fallback: number): number {
    return Math.abs(this.readNumber(value, fallback));
  }
}
