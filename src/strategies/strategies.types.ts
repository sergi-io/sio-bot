import type { SioBot } from '@/siobot/SioBot';
import type { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { ALXPosition } from '@/domain/ALXPosition';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

export type EnterStrategyActionExecuted = {
  strategyName: string;
  params: Record<string, any>;
  action: EnterStrategyAction;
  kline: ALXKline;
  riskRewardRatio: number;
};

export type ExitStrategyActionExecuted = {
  strategyName: string;
  params: Record<string, any>;
  action: ExitStrategyAction;
  kline: ALXKline;
};

export enum EnterStrategyAction {
  ENTER_LONG = 'ENTER_LONG',
  ENTER_SHORT = 'ENTER_SHORT',
}

export enum ExitStrategyAction {
  EXIT_CLOSE = 'EXIT_CLOSE',
}

export interface EnterStrategy {
  bot: SioBot;
  eventReactStrategy: EventReactStrategy;
  execute(klineBuffer: RollingWindowBuffer<ALXKline>): EnterStrategyActionExecuted | false;
}

export interface ExitStrategy {
  bot: SioBot;
  eventReactStrategy: EventReactStrategy;
  execute(
    klineBuffer: RollingWindowBuffer<ALXKline>,
    position: ALXPosition
  ): ExitStrategyActionExecuted | false;
}
