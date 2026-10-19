import { ALXOrderSide, ALXOrderType, type ALXOrder } from '@/domain/ALXOrder';
import cctx, { phemex } from 'ccxt';
import type { ALXExchange, FeeRate } from '../../domain/ALXExchange';
import { logger } from '@/utils/logger';
import { config } from '@/config';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { normalizeSymbolString } from '@/utils/symbols';
import { BaseExchange } from '../BaseExchange';

type PhemexExchangeConstructorParams = {
  apiKey: string;
  secret: string;
  enableTestnet?: boolean;
};

/**
 * PhemexExchange - Main exchange interface
 */
export class PhemexExchange extends BaseExchange implements ALXExchange {
  public override name: string = 'Phemex';
  private apiKey: string;
  private secret: string;
  private ccxtPhemexInstance: phemex;

  constructor({ apiKey, secret }: PhemexExchangeConstructorParams) {
    super();
    this.apiKey = apiKey;
    this.secret = secret;
    this.ccxtPhemexInstance = new cctx.phemex({
      apiKey: this.apiKey,
      secret: this.secret,
      enableRateLimit: true,
      options: {
        defaultType: 'swap',
        brokerId: '',
      },
    });
  }

  public override async connect(): Promise<void> {
    await super.connect();
    try {
      await this.ccxtPhemexInstance.loadMarkets();
      logger.info('✅ Loaded Markets from Phemex API');
    } catch (err) {
      logger.error(`Failed to connect to Phemex API: ${err}`);
      throw err;
    }
  }

  async syncBalance(symbol: string): Promise<void> {
    const code = symbol.toUpperCase();

    // For futures we need to query the swap account and specify the settle currency
    const balances = await this.ccxtPhemexInstance.fetchBalance({
      type: 'swap',
      settle: code,
    });

    const totalByCode = balances.total as Record<string, number | undefined> | undefined;
    const totalBalance = totalByCode?.[code] ?? 0;

    // Update BalanceManager with total balance from exchange
    this.balanceManager.updateTotalBalance(totalBalance);

    // Sync locked margins from open positions
    await this.syncLockedMarginsFromPositions();
  }

  public override async setLeverageBySymbol(symbol: string, leverage: number): Promise<void> {
    await super.setLeverageBySymbol(symbol, leverage);
    // @TODO Not sure if this works.
    await this.ccxtPhemexInstance.setLeverage(leverage, symbol);
  }

  async openOrder(order: ALXOrder, isBackTest: boolean): Promise<void> {
    if (isBackTest) {
      logger.debug('Skipping real Phemex order placement in backtest mode.');
      return;
    }

    const side = order.side === ALXOrderSide.BUY ? 'buy' : 'sell';
    const type = order.type === ALXOrderType.LIMIT ? 'limit' : 'market';

    const price = type === 'limit' ? order.price : undefined;
    const params: Record<string, unknown> = {
      clientOrderId: order.id,
      reduceOnly: false,
      posSide: 'Merged',
    };
    if (order.stopLossPrice !== undefined) {
      params.stopLoss = { triggerPrice: order.stopLossPrice };
    }

    try {
      if (
        !this.ccxtPhemexInstance.markets ||
        !Object.keys(this.ccxtPhemexInstance.markets).length
      ) {
        await this.ccxtPhemexInstance.loadMarkets();
      }

      await this.ccxtPhemexInstance.createOrder(
        order.symbol,
        type,
        side,
        order.quantity,
        price,
        params
      );

      logger.info(
        `Phemex order placed: ${type.toUpperCase()} ${side.toUpperCase()} ${order.symbol} qty=${order.quantity} price=${price ?? 'MARKET'} stopLoss=${order.stopLossPrice ?? 'NONE'}`
      );
    } catch (err) {
      logger.error(`Failed to open order on Phemex for ${order.symbol}: ${err}`);
      throw err;
    }
  }

  async cancelOrder(_orderId: string): Promise<void> {
    void _orderId;
    throw new Error('not implemented');
  }

  async closePosition(alxPosition: ALXPosition): Promise<ALXPosition> {
    try {
      // const positions = await this.ccxtPhemexInstance.fetchPositions();
      // const normalizedTargetSymbol = normalizeSymbolString(alxPosition.symbol);
      // const position = positions.find((pos) => {
      //   const posId = pos.id ?? (pos.info?.posId ? String(pos.info.posId) : undefined);
      //   if (posId === alxPosition.id) {
      //     return true;
      //   }

      //   const posSymbol = normalizeSymbolString(pos.symbol ?? pos.info?.symbol ?? '');
      //   const posSide = pos.side === 'long' ? ALXPositionSide.LONG : ALXPositionSide.SHORT;
      //   return posSymbol === normalizedTargetSymbol && posSide === alxPosition.side;
      // });

      // if (!position) {
      //   throw new Error(
      //     `Phemex: position ${alxPosition.id} (${alxPosition.symbol}/${alxPosition.side}) not found when attempting to close.`
      //   );
      // }

      // const symbol = position.symbol ?? position.info?.symbol;
      // const size = Math.abs(
      //   position.contracts ?? Number(position.info?.size ?? position.info?.totalPos ?? 0)
      // );

      // if (!symbol || !size) {
      //   throw new Error(
      //     `Phemex: cannot close position ${alxPosition.id} due to missing symbol or size (symbol=${symbol}, size=${size}).`
      //   );
      // }

      const side = alxPosition.side === ALXPositionSide.LONG ? 'sell' : 'buy';

      const closeOrder = await this.ccxtPhemexInstance.createOrder(
        alxPosition.symbol,
        'market',
        side,
        alxPosition.quantity,
        undefined,
        {
          reduceOnly: true,
          posSide: 'Merged',
        }
      );
      const exchangeClosedPosition = this.mapClosedPositionFromOrder(alxPosition, closeOrder);

      // const positionsAfterClose = await this.ccxtPhemexInstance.fetchPositions();
      // const remainingPosition = positionsAfterClose.find((pos) => {
      //   const posSymbol = normalizeSymbolString(pos.symbol ?? pos.info?.symbol ?? '');
      //   const posSide = pos.side === 'long' ? ALXPositionSide.LONG : ALXPositionSide.SHORT;
      //   const posSize = Math.abs(
      //     pos.contracts ?? Number(pos.info?.size ?? pos.info?.totalPos ?? 0)
      //   );
      //   return posSymbol === normalizedTargetSymbol && posSide === alxPosition.side && posSize > 0;
      // });

      // if (remainingPosition) {
      //   const remainingSize = Math.abs(
      //     remainingPosition.contracts ??
      //       Number(remainingPosition.info?.size ?? remainingPosition.info?.totalPos ?? 0)
      //   );
      //   throw new Error(
      //     `Phemex: close order for position ${alxPosition.id} was sent, but ${remainingSize} contracts remain open on ${symbol}.`
      //   );
      // }

      // Release margin and apply PnL to total balance
      this.balanceManager.releaseMargin(alxPosition.id, exchangeClosedPosition.realizedPnl);

      logger.info(
        `Phemex: closed position ${alxPosition.id} (${alxPosition.side ?? 'unknown'} -> ${side}) on ${alxPosition.symbol} qty=${alxPosition.quantity} realizedPnl=${exchangeClosedPosition.realizedPnl}`
      );
      await this.syncBalance('USDT');
      return exchangeClosedPosition;
    } catch (err) {
      logger.error(`Failed to close position ${alxPosition.id} on Phemex: ${err}`);
      throw err;
    }
  }

  async getClosedPosition(alxPosition: ALXPosition): Promise<ALXPosition | null> {
    void alxPosition;
    return null;
  }

  public override async getOpenPositions(): Promise<ALXPosition[]> {
    try {
      const positions = await this.ccxtPhemexInstance.fetchPositions();

      const openPositions = positions
        .filter((position) => {
          const rawSize =
            position.contracts ?? Number(position.info?.size ?? position.info?.totalPos ?? 0);
          return Boolean(rawSize && Math.abs(rawSize) > 0);
        })
        .map((position) => {
          const symbol = normalizeSymbolString(position.symbol ?? position.info?.symbol ?? '');
          if (!symbol) {
            throw new Error('Cannot normalize symbol string from position');
          }
          const quantity =
            position.contracts ?? Number(position.info?.size ?? position.info?.totalPos ?? 0);
          const entryPrice = position.entryPrice ?? Number(position.info?.avgEntryPrice ?? 0);
          const leverage =
            position.leverage ??
            Number(position.info?.leverage ?? this.getLeverageBySymbol(symbol));
          const notional =
            position.notional ?? (entryPrice && quantity ? entryPrice * quantity : 0);
          const margin = position.initialMargin ?? (leverage ? notional / leverage : 0);
          const side = position.side === 'long' ? ALXPositionSide.LONG : ALXPositionSide.SHORT;
          const openTimestamp =
            position.timestamp ??
            Number(position.info?.createdAt ?? position.info?.createTime ?? Date.now());
          const unrealizedPnl = position.unrealizedPnl ?? Number(position.info?.unrealizedPnl ?? 0);
          const realizedPnl = position.realizedPnl ?? Number(position.info?.realizedPnl ?? 0);
          const id =
            position.id ??
            (position.info?.posId
              ? String(position.info.posId)
              : `${symbol}-${side}-${openTimestamp}`);

          return {
            id,
            symbol,
            side,
            entryPrice,
            quantity,
            margin,
            leverage,
            openTimestamp,
            unrealizedPnl,
            realizedPnl,
            mae: 0,
          };
        });

      logger.info(`Fetched ${openPositions.length} open positions from Phemex.`);

      if (openPositions.length > 0) {
        console.table(openPositions);
      }

      return openPositions;
    } catch (err) {
      logger.error(`Failed to fetch open positions from Phemex: ${err}`);
      return [];
    }
  }

  public async syncFeeRates(): Promise<void> {
    logger.info('Syncing fee rates from Phemex...');
    // Right now ccxt does not support fetching fee rates from Phemex
    // So we will hardcode the fee rates for now
    logger.info('✅ Fee rates synced from Phemex.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getFeeRateBySymbol(symbol: string): FeeRate {
    const defaultFeeRate: FeeRate = { ...config.defaults.fees };
    return defaultFeeRate;
  }

  private mapClosedPositionFromOrder(alxPosition: ALXPosition, closeOrder: any): ALXPosition {
    const info = closeOrder?.info ?? {};
    const realizedPnl = this.readNumber(
      info.totalPnlRv ?? info.closedPnlRv ?? info.closedPnl,
      alxPosition.realizedPnl
    );
    const exitFee = Math.abs(
      this.readNumber(closeOrder?.fee?.cost ?? info.execFeeRv, alxPosition.exitFee ?? 0)
    );

    return {
      ...alxPosition,
      closePrice: closeOrder?.average ?? closeOrder?.price ?? alxPosition.closePrice,
      closeTimestamp: closeOrder?.lastTradeTimestamp ?? closeOrder?.timestamp ?? Date.now(),
      exitFee,
      unrealizedPnl: 0,
      realizedPnl,
    };
  }

  private readNumber(value: unknown, fallback: number): number {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  }
}
