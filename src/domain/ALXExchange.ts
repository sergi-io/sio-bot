import type { RollingWindowBuffer } from './../utils/RollingWindowBuffer';
import type { ALXKline } from '@/domain/ALXKline';
import type { ALXOrder, ALXOrderLimitType, ALXOrderType } from '@/domain/ALXOrder';
import type { ALXPosition } from '@/domain/ALXPosition';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import type { BalanceManager } from '@/balance/BalanceManager';

export type ExchangeKlineFetchLimit = 5 | 10 | 50 | 100 | 500 | 1000;

export type FeeRate = {
  makerRate: number;
  takerRate: number;
  fundingRate: number;
};
export type FeeRatesBySymbol = Map<string, FeeRate>;

export type ClosePositionOptions = {
  orderType?: ALXOrderType;
  limitType?: ALXOrderLimitType;
  price?: number;
};

export interface ALXExchange {
  balanceManager: BalanceManager;
  name: string;
  setLeverageBySymbol(symbol: string, leverage: number): Promise<void>;
  getLeverageBySymbol(symbol: string): number;
  syncBalance(symbol: string): Promise<void>;
  getBalance(): Promise<number>;
  openOrder(order: ALXOrder, isBackTest: boolean): Promise<void>;
  cancelOrder(orderId: string): Promise<void>;
  closePosition(corePosition: ALXPosition, options?: ClosePositionOptions): Promise<ALXPosition>;
  getClosedPosition(corePosition: ALXPosition): Promise<ALXPosition | null>;
  getKlinesBuffer(symbol: string, timeframe: string): RollingWindowBuffer<ALXKline> | null;
  addKlinesToBuffer(symbol: string, timeframe: ALXTimeFrame, klines: ALXKline[]): void;
  subscribeKlines(
    symbol: string,
    timeframes: ALXTimeFrame[],
    onKlineReceived: (
      newKlines: ALXKline[],
      klinesBuffer: RollingWindowBuffer<ALXKline> | null
    ) => Promise<void>
  ): Promise<void>;
  getCurrentPrice(symbol: string, timeframe: ALXTimeFrame): number | null;
  unsubscribeKlines(symbol: string, timeframes: ALXTimeFrame[]): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getOpenPositions(): Promise<ALXPosition[]>;
  syncFeeRates(): Promise<void>;
  getFeeRateBySymbol(symbol: string): FeeRate;
  warmUpKlinesBuffer(symbol: string, timeframes: ALXTimeFrame[], limit: number): Promise<void>;
}
