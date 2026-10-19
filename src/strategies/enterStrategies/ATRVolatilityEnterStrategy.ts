import {
  EnterStrategyAction,
  type EnterStrategyActionExecuted,
  type EnterStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import { getKlineColor } from '@/ta/helpers/getKlineColor';
import type { SioATR } from '@/ta/indicators/SioATR';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface ATRVolatilityEnterStrategyParams {
  atrPeriod: number;
  atrMultiplier: number;
  riskRewardRatio: number;
}

export class ATRVolatilityEnterStrategy implements EnterStrategy {
  public name: string = 'ATRVolatilityEnterStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;
  private params: ATRVolatilityEnterStrategyParams;
  private atr: SioATR;

  constructor(bot: SioBot, params: ATRVolatilityEnterStrategyParams) {
    this.bot = bot;
    this.params = params;
    // This needs to be set in the constructor
    this.atr = this.bot.taManager.getATR(this.params.atrPeriod, this.bot.config.timeFrameToTrade);
  }

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): EnterStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      return false;
    }

    const currentAtr = this.atr.buffer.getLast();

    if (currentAtr === null) {
      return false;
    }

    if (!currentAtr) {
      return false;
    }

    const currentKlineSize = currentKline.high - currentKline.low;

    if (!this.bot.isBackTesting()) {
      logger.debug(`[${this.name}] -> ATR: ${currentAtr} | Kline Size: ${currentKlineSize}`);
    }

    let action: EnterStrategyAction | null = null;

    if (
      getKlineColor(currentKline) === 'green' &&
      currentKlineSize > currentAtr * this.params.atrMultiplier
    ) {
      action = EnterStrategyAction.ENTER_SHORT;
    } else if (
      getKlineColor(currentKline) === 'red' &&
      currentKlineSize > currentAtr * this.params.atrMultiplier
    ) {
      action = EnterStrategyAction.ENTER_LONG;
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
