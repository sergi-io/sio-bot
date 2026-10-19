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

interface ProfitExitStrategyParams {
  profitToExit: number;
}

export class ProfitExitStrategy implements ExitStrategy {
  public name: string = 'ProfitExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.DELTA_KLINE;
  public bot: SioBot;
  private params: ProfitExitStrategyParams;

  constructor(bot: SioBot, params: ProfitExitStrategyParams) {
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
      logger.warn(`ProfitExitStrategy: Cannot fetch current price for symbol ${position.symbol}`);
      return false;
    }
    if (position.realizedPnl >= this.params.profitToExit) {
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
