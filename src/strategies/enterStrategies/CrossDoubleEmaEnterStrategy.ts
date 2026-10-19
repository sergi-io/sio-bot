import { EventReactStrategy } from '@/siobot/BotConfig';
import {
  EnterStrategyAction,
  type EnterStrategyActionExecuted,
  type EnterStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import type { ALXKline } from '@/domain/ALXKline';
import type { EMABufferedIndicator } from '@/ta/indicators/SioEMA';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface CrossDoubleEMAEnterStrategyParams {
  fastPeriod: number;
  slowPeriod: number;
  riskRewardRatio: number;
}

export class CrossDoubleEMAEnterStrategy implements EnterStrategy {
  public name: string = 'CrossDoubleEMAEnterStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;
  private params: CrossDoubleEMAEnterStrategyParams;
  private fastEma: EMABufferedIndicator;
  private slowEma: EMABufferedIndicator;

  constructor(bot: SioBot, params: CrossDoubleEMAEnterStrategyParams) {
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

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): EnterStrategyActionExecuted | false {
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

    const crossedUp = fastPrev <= slowPrev && fastCurrent > slowCurrent;
    const crossedDown = fastPrev >= slowPrev && fastCurrent < slowCurrent;

    if (!this.bot.isBackTesting()) {
      logger.debug(
        `[${this.name}] fastEMA(${this.params.fastPeriod}): ${fastCurrent.toFixed(2)} | slowEMA(${this.params.slowPeriod}): ${slowCurrent.toFixed(2)}`
      );
    }

    let action: EnterStrategyAction | null = null;
    if (crossedUp) {
      action = EnterStrategyAction.ENTER_LONG;
    }

    if (crossedDown) {
      action = EnterStrategyAction.ENTER_SHORT;
    }

    if (!action) {
      return false;
    }

    return {
      kline: currentKline,
      strategyName: this.name,
      params: this.params,
      action,
      riskRewardRatio: this.params.riskRewardRatio,
    };
  }
}
