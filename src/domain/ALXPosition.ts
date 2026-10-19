import type { RiskStrategyActionExecuted } from '@/risk/riskStrategies.types';
import type {
  EnterStrategyActionExecuted,
  ExitStrategyActionExecuted,
} from '@/strategies/strategies.types';

export enum ALXPositionSide {
  LONG = 'long',
  SHORT = 'short',
}

export interface ALXPosition {
  id: string;
  symbol: string;
  side: ALXPositionSide;
  entryPrice: number;
  quantity: number;
  margin: number;
  leverage: number;
  openTimestamp: number;
  closeTimestamp?: number;
  closePrice?: number;
  enterFee?: number;
  exitFee?: number;
  unrealizedPnl: number; // do not include fees
  realizedPnl: number; // include fees
  openedByStrategies?: Array<EnterStrategyActionExecuted>;
  riskStrategiesExecuted?: Array<RiskStrategyActionExecuted>;
  closedByStrategy?: ExitStrategyActionExecuted;
  mae: number; // Maximum Adverse Excursion
  minRealizedPnl?: number;
  maxRealizedPnl?: number;
  breakevenLastNotifiedTimestamp?: number;
}
