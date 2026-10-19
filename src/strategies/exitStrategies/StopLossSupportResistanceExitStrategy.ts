import {
  ExitStrategyAction,
  type ExitStrategyActionExecuted,
  type ExitStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import type { ALXKline } from '@/domain/ALXKline';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { logger } from '@/utils/logger';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import type { HighLowsBufferedIndicator } from '@/ta/indicators/SioHighLows';

interface StopLossSupportResistanceExitStrategyParams {
  pastKlinesToCheck: number;
}

export class StopLossSupportResistanceExitStrategy implements ExitStrategy {
  public name: string = 'StopLossSupportResistanceExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.DELTA_KLINE;
  public bot: SioBot;
  private params: StopLossSupportResistanceExitStrategyParams;
  private highLowsTA: HighLowsBufferedIndicator;

  constructor(bot: SioBot, params: StopLossSupportResistanceExitStrategyParams) {
    this.bot = bot;
    this.params = params;
    this.highLowsTA = this.bot.taManager.getHighLows(
      this.params.pastKlinesToCheck,
      true,
      this.bot.config.timeFrameToTrade
    );
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

    const isLong = position.side === ALXPositionSide.LONG;
    const isShort = position.side === ALXPositionSide.SHORT;

    if (!isLong && !isShort) {
      return false;
    }

    if (currentPrice === null) {
      logger.warn(
        `StopLossSupportResistanceExitStrategy: Cannot fetch current price for symbol ${position.symbol}`
      );
      return false;
    }

    const highLows = this.highLowsTA.buffer.getLast();
    if (!highLows) {
      return false;
    }

    const { hh, ll } = highLows;

    let action: ExitStrategyAction | null = null;

    if (isLong && currentPrice <= ll) {
      action = ExitStrategyAction.EXIT_CLOSE;
    } else if (isShort && currentPrice >= hh) {
      action = ExitStrategyAction.EXIT_CLOSE;
    }

    if (!action) {
      return false;
    }

    return {
      strategyName: this.name,
      params: this.params,
      action: ExitStrategyAction.EXIT_CLOSE,
      kline: currentKline!,
    };
  }
}
