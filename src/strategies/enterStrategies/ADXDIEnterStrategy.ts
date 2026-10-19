import {
  EnterStrategyAction,
  type EnterStrategyActionExecuted,
  type EnterStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { SioADXDI } from '@/ta/indicators/SioADXDI';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface ADXDIEnterStrategyParams {
  period: number;
  diSpreadThreshold: number;
  adx: number;
  riskRewardRatio: number;
}

export class ADXDIEnterStrategy implements EnterStrategy {
  public name: string = 'ADXDIEnterStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;
  private params: ADXDIEnterStrategyParams;
  private adxdi: SioADXDI;

  constructor(bot: SioBot, params: ADXDIEnterStrategyParams) {
    this.bot = bot;
    this.params = params;

    this.adxdi = this.bot.taManager.getADXDI(this.params.period, this.bot.config.timeFrameToTrade);
  }

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): EnterStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();
    if (!currentKline) {
      return false;
    }

    const currentIndicator = this.adxdi.buffer.getLast();
    if (!currentIndicator) {
      return false;
    }
    const adx = currentIndicator.adx;
    const plusDi = currentIndicator.pdi;
    const minusDi = currentIndicator.mdi;

    if (
      adx === undefined ||
      plusDi === undefined ||
      minusDi === undefined ||
      Number.isNaN(adx) ||
      Number.isNaN(plusDi) ||
      Number.isNaN(minusDi)
    ) {
      return false;
    }

    if (!this.bot.isBackTesting()) {
      logger.debug(
        `[${this.name}] -> ADX: ${adx.toFixed(2)} | +DI: ${plusDi.toFixed(2)} | -DI: ${minusDi.toFixed(2)}`
      );
    }

    if (adx < this.params.adx) {
      return false;
    }

    const diSpread = plusDi - minusDi;

    let action: EnterStrategyAction | null = null;
    if (diSpread > this.params.diSpreadThreshold) {
      action = EnterStrategyAction.ENTER_LONG;
    } else if (diSpread < -this.params.diSpreadThreshold) {
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
