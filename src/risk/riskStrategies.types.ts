export enum RiskStrategyAction {
  DCA = 'DCA',
  TRAILING_STOP_LOSS = 'TRAILING_STOP_LOSS',
  BREAKOUT_STOP_LOSS = 'BREAKOUT_STOP_LOSS',
}
import type { SioBot } from '@/siobot/SioBot';
import type { ALXKline } from '@/domain/ALXKline';

export type RiskStrategyActionExecuted = {
  strategyName: string;
  params: Record<string, any>;
  action: RiskStrategyAction;
  executionTimestamp: number;
  kline: ALXKline;
};

export interface RiskStrategy {
  bot: SioBot;
  execute(kline: ALXKline): Promise<void>;
}
