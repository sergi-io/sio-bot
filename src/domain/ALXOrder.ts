import type { RiskStrategyActionExecuted } from '@/risk/riskStrategies.types';
import type { EnterStrategyActionExecuted } from '@/strategies/strategies.types';

export enum ALXOrderSide {
  BUY = 'buy',
  SELL = 'sell',
}
export enum ALXOrderType {
  MARKET = 'market',
  LIMIT = 'limit',
}
export enum ALXOrderLimitType {
  GTC = 'gtc',
  POST_ONLY = 'post_only',
}

export interface ALXOrder {
  id: string;
  symbol: string;
  margin: number;
  quantity: number;
  leverage: number;
  price: number;
  side: ALXOrderSide;
  type: ALXOrderType;
  limitType?: ALXOrderLimitType;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  openedTimestamp: number;
  openedByStrategies?: EnterStrategyActionExecuted[];
  riskStrategiesExecuted?: RiskStrategyActionExecuted[];
}
