import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { SioADXDI } from '@/ta/indicators/SioADXDI';
import type { EMABufferedIndicator } from '@/ta/indicators/SioEMA';
import type { VWAPBufferedIndicator } from '@/ta/indicators/SioVWAP';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import {
  EnterStrategyAction,
  type EnterStrategy,
  type EnterStrategyActionExecuted,
} from '../strategies.types';

interface MicroTrendRetestBreakEnterStrategyParams {
  emaFastPeriod: number;
  emaSlowPeriod: number;
  adxPeriod: number;
  adxThreshold: number;
  riskRewardRatio: number;
}

type PendingPullbackSide = 'long' | 'short';

interface PendingPullbackSetup {
  side: PendingPullbackSide;
  armedAtTimestamp: number;
  pullbackHigh: number;
  pullbackLow: number;
}

interface FiveMinuteTrendContext {
  close: number;
  vwap: number;
  emaSlow: number;
  prevEmaSlow: number;
  adx: number;
  prevAdx: number;
  bias: PendingPullbackSide | 'neutral';
}

export class MicroTrendRetestBreakEnterStrategy implements EnterStrategy {
  public name: string = 'MicroTrendRetestBreakEnterStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;

  private params: MicroTrendRetestBreakEnterStrategyParams;
  private oneMinuteEmaFast: EMABufferedIndicator;
  private fiveMinuteEmaSlow: EMABufferedIndicator;
  private fiveMinuteAdx: SioADXDI;
  private fiveMinuteVwap: VWAPBufferedIndicator;
  private pendingSetup: PendingPullbackSetup | null = null;

  constructor(bot: SioBot, params: MicroTrendRetestBreakEnterStrategyParams) {
    this.bot = bot;
    this.params = { ...params };
    this.oneMinuteEmaFast = this.bot.taManager.getEMA(this.params.emaFastPeriod, '5m');
    this.fiveMinuteEmaSlow = this.bot.taManager.getEMA(this.params.emaSlowPeriod, '15m');
    this.fiveMinuteAdx = this.bot.taManager.getADXDI(this.params.adxPeriod, '15m');
    this.fiveMinuteVwap = this.bot.taManager.getVWAP('15m');
  }

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): EnterStrategyActionExecuted | false {
    if (this.bot.config.timeFrameToTrade !== '5m') {
      this.pendingSetup = null;
      return false;
    }

    const currentKline = klinesBuffer.getLast();
    if (!currentKline || currentKline.timeframe !== '5m') {
      return false;
    }

    const currentEmaFast = this.oneMinuteEmaFast.buffer.getLast();
    if (!isFiniteNumber(currentEmaFast)) {
      return false;
    }

    const trendContext = this.getFiveMinuteTrendContext();

    if (!trendContext) {
      this.pendingSetup = null;
      return false;
    }

    this.invalidatePendingSetup(currentKline, currentEmaFast, trendContext.bias);

    if (this.pendingSetup && currentKline.timestamp > this.pendingSetup.armedAtTimestamp) {
      if (this.pendingSetup.side === 'long' && trendContext.bias === 'long') {
        if (currentKline.close > this.pendingSetup.pullbackHigh) {
          return this.buildAction(
            currentKline,
            EnterStrategyAction.ENTER_LONG,
            this.pendingSetup,
            trendContext
          );
        }
      }

      if (this.pendingSetup.side === 'short' && trendContext.bias === 'short') {
        if (currentKline.close < this.pendingSetup.pullbackLow) {
          return this.buildAction(
            currentKline,
            EnterStrategyAction.ENTER_SHORT,
            this.pendingSetup,
            trendContext
          );
        }
      }
    }

    if (this.pendingSetup) {
      return false;
    }

    if (trendContext.bias === 'long' && this.shouldArmLongPullback(currentKline, currentEmaFast)) {
      this.pendingSetup = {
        side: 'long',
        armedAtTimestamp: currentKline.timestamp,
        pullbackHigh: currentKline.high,
        pullbackLow: currentKline.low,
      };

      if (!this.bot.isBackTesting()) {
        logger.debug(
          `[${this.name}] Armed long pullback @ ${currentKline.timestamp} | high=${currentKline.high.toFixed(4)} low=${currentKline.low.toFixed(4)} emaFast=${currentEmaFast.toFixed(4)}`
        );
      }
    } else if (
      trendContext.bias === 'short' &&
      this.shouldArmShortPullback(currentKline, currentEmaFast)
    ) {
      this.pendingSetup = {
        side: 'short',
        armedAtTimestamp: currentKline.timestamp,
        pullbackHigh: currentKline.high,
        pullbackLow: currentKline.low,
      };

      if (!this.bot.isBackTesting()) {
        logger.debug(
          `[${this.name}] Armed short pullback @ ${currentKline.timestamp} | high=${currentKline.high.toFixed(4)} low=${currentKline.low.toFixed(4)} emaFast=${currentEmaFast.toFixed(4)}`
        );
      }
    }

    return false;
  }

  private buildAction(
    currentKline: ALXKline,
    action: EnterStrategyAction,
    pendingSetup: PendingPullbackSetup,
    trendContext: FiveMinuteTrendContext
  ): EnterStrategyActionExecuted {
    this.pendingSetup = null;

    return {
      kline: currentKline,
      strategyName: this.name,
      params: {
        ...this.params,
        pullbackHigh: pendingSetup.pullbackHigh,
        pullbackLow: pendingSetup.pullbackLow,
        informationalStopLossPrice:
          action === EnterStrategyAction.ENTER_LONG
            ? pendingSetup.pullbackLow
            : pendingSetup.pullbackHigh,
        fiveMinuteClose: trendContext.close,
        fiveMinuteVWAP: trendContext.vwap,
        fiveMinuteEMASlow: trendContext.emaSlow,
        fiveMinutePreviousEMASlow: trendContext.prevEmaSlow,
        fiveMinuteADX: trendContext.adx,
        fiveMinutePreviousADX: trendContext.prevAdx,
        fiveMinuteBias: trendContext.bias,
      },
      action,
      riskRewardRatio: this.params.riskRewardRatio,
    };
  }

  private invalidatePendingSetup(
    currentKline: ALXKline,
    currentEmaFast: number,
    trendBias: FiveMinuteTrendContext['bias']
  ): void {
    if (!this.pendingSetup) {
      return;
    }

    const setup = this.pendingSetup;
    const invalidatedByBias = trendBias !== setup.side;
    const invalidatedByEmaLoss =
      (setup.side === 'long' && currentKline.close < currentEmaFast) ||
      (setup.side === 'short' && currentKline.close > currentEmaFast);

    if (!invalidatedByBias && !invalidatedByEmaLoss) {
      return;
    }

    if (!this.bot.isBackTesting()) {
      logger.debug(
        `[${this.name}] Clearing ${setup.side} pullback @ ${setup.armedAtTimestamp} | trendBias=${trendBias} close=${currentKline.close.toFixed(4)} emaFast=${currentEmaFast.toFixed(4)}`
      );
    }

    this.pendingSetup = null;
  }

  private shouldArmLongPullback(currentKline: ALXKline, currentEmaFast: number): boolean {
    return currentKline.low <= currentEmaFast && currentKline.close > currentEmaFast;
  }

  private shouldArmShortPullback(currentKline: ALXKline, currentEmaFast: number): boolean {
    return currentKline.high >= currentEmaFast && currentKline.close < currentEmaFast;
  }

  private getFiveMinuteTrendContext(): FiveMinuteTrendContext | null {
    const close = this.bot.exchange.getCurrentPrice(this.bot.config.assetSymbol, '5m');
    const currentEmaSlow = this.fiveMinuteEmaSlow.buffer.getLast();
    const previousEmaSlow = this.fiveMinuteEmaSlow.buffer.getAt(-1);
    const currentAdxResult = this.fiveMinuteAdx.buffer.getLast();
    const previousAdxResult = this.fiveMinuteAdx.buffer.getAt(-1);
    const currentVwapResult = this.fiveMinuteVwap.buffer.getLast();

    const vwap = currentVwapResult?.vwap;
    const adx = currentAdxResult?.adx;
    const prevAdx = previousAdxResult?.adx;

    if (
      !isFiniteNumber(close) ||
      !isFiniteNumber(vwap) ||
      !isFiniteNumber(currentEmaSlow) ||
      !isFiniteNumber(previousEmaSlow) ||
      !isFiniteNumber(adx) ||
      !isFiniteNumber(prevAdx)
    ) {
      return null;
    }

    const isLongBias =
      close > vwap &&
      currentEmaSlow > previousEmaSlow &&
      adx > this.params.adxThreshold &&
      adx > prevAdx;
    const isShortBias =
      close < vwap &&
      currentEmaSlow < previousEmaSlow &&
      adx > this.params.adxThreshold &&
      adx > prevAdx;

    return {
      close: close,
      vwap,
      emaSlow: currentEmaSlow,
      prevEmaSlow: previousEmaSlow,
      adx,
      prevAdx,
      bias: isLongBias ? 'long' : isShortBias ? 'short' : 'neutral',
    };
  }
}

function isFiniteNumber(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
