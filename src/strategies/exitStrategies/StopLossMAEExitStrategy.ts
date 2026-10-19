import {
  ExitStrategyAction,
  type ExitStrategyActionExecuted,
  type ExitStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import type { ALXKline } from '@/domain/ALXKline';
import type { ALXPosition } from '@/domain/ALXPosition';
import { logger } from '@/utils/logger';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface StopLossMAEExitStrategyParams {
  MAEThreshold: number;
}

export class StopLossMAEExitStrategy implements ExitStrategy {
  public name: string = 'StopLossMAEExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.DELTA_KLINE;
  public bot: SioBot;
  private params: StopLossMAEExitStrategyParams;

  constructor(bot: SioBot, params: StopLossMAEExitStrategyParams) {
    this.bot = bot;
    this.params = params;
  }

  public execute(
    klinesBuffer: RollingWindowBuffer<ALXKline>,
    position: ALXPosition
  ): ExitStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();
    const currentPrice = this.bot.exchange.getCurrentPrice(
      position.symbol,
      this.bot.config.timeFrameToTrade
    );
    if (currentPrice === null) {
      logger.warn(
        `StopLossMAEExitStrategy: Cannot fetch current price for symbol ${position.symbol}`
      );
      return false;
    }
    if ((position.mae ?? 0) >= this.params.MAEThreshold) {
      return {
        strategyName: this.name,
        params: this.params,
        action: ExitStrategyAction.EXIT_CLOSE,
        kline: currentKline!,
      };
    }

    return false;
  }
}
