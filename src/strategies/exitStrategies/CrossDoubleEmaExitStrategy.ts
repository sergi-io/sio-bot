import {
  ExitStrategyAction,
  type ExitStrategyActionExecuted,
  type ExitStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { ALXPosition } from '@/domain/ALXPosition';
import { ALXPositionSide } from '@/domain/ALXPosition';
import type { EMABufferedIndicator } from '@/ta/indicators/SioEMA';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface CrossDoubleEMAExitStrategyParams {
  fastPeriod: number;
  slowPeriod: number;
}

export class CrossDoubleEMAExitStrategy implements ExitStrategy {
  public name: string = 'CrossDoubleEMAExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;
  private params: CrossDoubleEMAExitStrategyParams;
  private fastEma: EMABufferedIndicator;
  private slowEma: EMABufferedIndicator;

  constructor(bot: SioBot, params: CrossDoubleEMAExitStrategyParams) {
    this.bot = bot;
    this.params = { ...params };

    if (this.params.fastPeriod >= this.params.slowPeriod) {
      this.params.fastPeriod = Math.max(1, this.params.slowPeriod - 1);
    }

    this.fastEma = this.bot.taManager.getEMA(
      this.params.fastPeriod,
      this.bot.config.timeFrameToTrade
    );
    this.slowEma = this.bot.taManager.getEMA(
      this.params.slowPeriod,
      this.bot.config.timeFrameToTrade
    );
  }

  public execute(
    klinesBuffer: RollingWindowBuffer<ALXKline>,
    position: ALXPosition
  ): ExitStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();
    if (!currentKline) {
      return false;
    }

    const fastCurrent = this.fastEma.buffer.getLast();
    const fastPrev = this.fastEma.buffer.getAt(-1);
    const slowCurrent = this.slowEma.buffer.getLast();
    const slowPrev = this.slowEma.buffer.getAt(-1);

    if (
      fastCurrent === undefined ||
      fastPrev === undefined ||
      slowCurrent === undefined ||
      slowPrev === undefined
    ) {
      return false;
    }

    const bullishCross = fastPrev <= slowPrev && fastCurrent > slowCurrent;
    const bearishCross = fastPrev >= slowPrev && fastCurrent < slowCurrent;

    if (!this.bot.isBackTesting()) {
      logger.debug(
        `[${this.name}] fastEMA(${this.params.fastPeriod}): ${fastCurrent.toFixed(2)} | slowEMA(${this.params.slowPeriod}): ${slowCurrent.toFixed(2)}`
      );
    }

    const exitLong = position.side === ALXPositionSide.LONG && bearishCross;
    const exitShort = position.side === ALXPositionSide.SHORT && bullishCross;

    if (!exitLong && !exitShort) {
      return false;
    }

    return {
      kline: currentKline,
      strategyName: this.name,
      params: this.params,
      action: ExitStrategyAction.EXIT_CLOSE,
    };
  }
}
