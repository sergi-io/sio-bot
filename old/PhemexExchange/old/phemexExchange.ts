import type { ALXOrder, ALXOrderSide, ALXOrderType } from '@/domain/ALXOrder';
import type { SIOExchange } from '../types';
import { PhemexRestClient } from './phemex-rest-client';
import { PhemexWsClient } from '../PhemexWsClient';
import { subscribeKlines, unsubscribeKlines } from './phemex-ws-client-klines';
import { klineNormalizer } from './phemexutils/klineNormalizer';
import { CommonOrderSide, CommonOrderType } from './types';
import type { Kline, PhemexWsKlinesMessage, PhemexSideType, PhemexOrderType } from './types';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';

/**
 * PhemexExchange - Main exchange interface
 */
export class PhemexExchange implements SIOExchange {
  private apiId: string;
  private apiSecret: string;
  private debug: boolean;
  public phemexRestClient: PhemexRestClient;
  public phemexWsClient: PhemexWsClient;

  constructor(apiId: string, apiSecret: string, debug: boolean = false) {
    this.apiId = apiId;
    this.apiSecret = apiSecret;
    this.debug = debug;
    this.phemexRestClient = new PhemexRestClient(apiId, apiSecret, debug);
    this.phemexWsClient = new PhemexWsClient(apiId, apiSecret, debug);
  }

  /**
   * Connect to Phemex WebSocket
   */
  async connect(): Promise<void> {
    console.log('Connecting to Phemex...');

    try {
      await this.phemexWsClient.connect();
      console.log('✅ Connected to Phemex WebSocket');
    } catch (err) {
      console.error(`Failed to connect to Phemex WebSocket:`, err);
      throw err;
    }
  }

  /**
   * Get exchange name
   */
  getName(): string {
    return 'Phemex';
  }

  /**
   * Get account balance
   */
  async getBalance(symbol: string): Promise<number> {
    try {
      const res = await this.phemexRestClient.getAccount().setCurrency(symbol).do();
      const balance = Math.round((res.account.accountBalanceRv as any) * 100) / 100;
      return balance;
    } catch (err) {
      console.error('Error getting balance:', err);
      throw err;
    }
  }

  async openOrder(order: ALXOrder): Promise<void> {
    // Transform common order side to Phemex side string
    let phemexSide: PhemexSideType;
    switch (order.side) {
      case CommonOrderSide.Buy:
        phemexSide = 'Buy' as PhemexSideType;
        break;
      case CommonOrderSide.Sell:
        phemexSide = 'Sell' as PhemexSideType;
        break;
      default:
        throw new Error(`Invalid order side: ${side}`);
    }

    // Transform common order type to Phemex order type string
    let phemexOrderType: PhemexOrderType;
    switch (order.type) {
      case CommonOrderType.Market:
        phemexOrderType = 'Market' as PhemexOrderType;
        break;
      case CommonOrderType.Limit:
        phemexOrderType = 'Limit' as PhemexOrderType;
        break;
      default:
        throw new Error(`Invalid order type: ${order.type}`);
    }

    await this.phemexRestClient
      .putOrder()
      .setSymbol(order.symbol)
      .setOrdType(phemexOrderType)
      .setPosSide('Merged')
      .setSide(phemexSide)
      .setOrderQtyRq('0.05')
      .do();
  }

  async cancelOrder(orderID: string): Promise<void> {
    throw new Error('not implemented');
  }

  async subscribeKlines(
    symbol: string,
    timeframe: ALXTimeFrame,
    onKlineReceived: (klines: Kline[]) => void
  ): Promise<void> {
    const wsHandler = (klinesMessage: PhemexWsKlinesMessage) => {
      if (!klinesMessage) {
        console.warn('Received nil klines message');
        return;
      }

      const klines: Kline[] = [];
      for (const phemexKline of klinesMessage.kline_p) {
        try {
          const kline = klineNormalizer(phemexKline);
          klines.push(kline);
        } catch (err) {
          console.error('Error parsing kline:', err);
          continue;
        }
      }

      if (klines.length > 0) {
        onKlineReceived(klines);
      }
    };

    await subscribeKlines(this.phemexWsClient, symbol, timeframe, wsHandler, this.debug);
  }

  /**
   * Unsubscribe from klines
   */
  async unsubscribeKlines(symbol: string, timeframe: number): Promise<void> {
    await unsubscribeKlines(this.phemexWsClient, symbol, timeframe, this.debug);
  }
}
