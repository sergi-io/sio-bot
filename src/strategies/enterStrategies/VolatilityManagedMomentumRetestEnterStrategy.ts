import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import type { SioADXDI } from '@/ta/indicators/SioADXDI';
import type { SioATR } from '@/ta/indicators/SioATR';
import type { EMABufferedIndicator } from '@/ta/indicators/SioEMA';
import type { VWAPBufferedIndicator } from '@/ta/indicators/SioVWAP';
import { logger } from '@/utils/logger';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import {
  EnterStrategyAction,
  type EnterStrategy,
  type EnterStrategyActionExecuted,
} from '../strategies.types';

export const VOLATILITY_MANAGED_MOMENTUM_RETEST_STRATEGY_NAME =
  'VolatilityManagedMomentumRetestEnterStrategy';

interface VolatilityManagedMomentumRetestEnterStrategyParams {
  regimeEMAPeriod: number;
  pullbackEMAPeriod: number;
  adxPeriod: number;
  adxThreshold: number;
  atrPeriod: number;
  minATRPercent: number;
  maxATRPercent: number;
  minFlowImbalance: number;
  flowLookback: number;
  stopBufferATRMultiplier: number;
  maxStopDistanceRate: number;
  riskRewardRatio: number;
}

type MomentumSide = 'long' | 'short';

interface PendingRetestSetup {
  side: MomentumSide;
  armedAtTimestamp: number;
  pullbackHigh: number;
  pullbackLow: number;
  stopLossPrice: number;
  atr: number;
}

interface RegimeContext {
  close: number;
  vwap: number;
  ema: number;
  prevEma: number;
  adx: number;
  prevAdx: number;
  bias: MomentumSide | 'neutral';
}

export class VolatilityManagedMomentumRetestEnterStrategy implements EnterStrategy {
  public name: string = VOLATILITY_MANAGED_MOMENTUM_RETEST_STRATEGY_NAME;
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;

  private params: VolatilityManagedMomentumRetestEnterStrategyParams;
  private regimeTimeframe: ALXTimeFrame;
  private tradeEMA: EMABufferedIndicator;
  private tradeVWAP: VWAPBufferedIndicator;
  private tradeATR: SioATR;
  private regimeEMA: EMABufferedIndicator;
  private regimeVWAP: VWAPBufferedIndicator;
  private regimeADX: SioADXDI;
  private pendingSetup: PendingRetestSetup | null = null;

  constructor(bot: SioBot, params: VolatilityManagedMomentumRetestEnterStrategyParams) {
    this.bot = bot;
    this.params = { ...params };
    this.regimeTimeframe = this.bot.config.timeFrameToDetectRegime;
    this.tradeEMA = this.bot.taManager.getEMA(
      this.params.pullbackEMAPeriod,
      this.bot.config.timeFrameToTrade
    );
    this.tradeVWAP = this.bot.taManager.getVWAP(this.bot.config.timeFrameToTrade);
    this.tradeATR = this.bot.taManager.getATR(
      this.params.atrPeriod,
      this.bot.config.timeFrameToTrade
    );
    this.regimeEMA = this.bot.taManager.getEMA(this.params.regimeEMAPeriod, this.regimeTimeframe);
    this.regimeVWAP = this.bot.taManager.getVWAP(this.regimeTimeframe);
    this.regimeADX = this.bot.taManager.getADXDI(this.params.adxPeriod, this.regimeTimeframe);
  }

  public execute(klinesBuffer: RollingWindowBuffer<ALXKline>): EnterStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();
    if (!currentKline || currentKline.timeframe !== this.bot.config.timeFrameToTrade) {
      return false;
    }

    const tradeEMA = this.tradeEMA.buffer.getLast();
    const tradeVWAP = this.tradeVWAP.buffer.getLast()?.vwap;
    const tradeATR = this.tradeATR.buffer.getLast();
    if (!isFiniteNumber(tradeEMA) || !isFiniteNumber(tradeVWAP) || !isFiniteNumber(tradeATR)) {
      this.pendingSetup = null;
      return false;
    }

    const atrPercent = (tradeATR / currentKline.close) * 100;
    if (atrPercent < this.params.minATRPercent || atrPercent > this.params.maxATRPercent) {
      this.pendingSetup = null;
      return false;
    }

    const regimeContext = this.getRegimeContext();
    if (!regimeContext) {
      this.pendingSetup = null;
      return false;
    }

    this.invalidatePendingSetup(currentKline, tradeEMA, tradeVWAP, regimeContext.bias);

    if (this.pendingSetup && currentKline.timestamp > this.pendingSetup.armedAtTimestamp) {
      return this.tryBreakRetest(currentKline, regimeContext);
    }

    if (this.pendingSetup || regimeContext.bias === 'neutral') {
      return false;
    }

    const flowImbalance = this.getFlowImbalance(klinesBuffer);
    if (!isFiniteNumber(flowImbalance)) {
      return false;
    }

    if (
      regimeContext.bias === 'long' &&
      flowImbalance >= this.params.minFlowImbalance &&
      this.isValidLongRetest(currentKline, tradeEMA, tradeVWAP)
    ) {
      this.armSetup('long', currentKline, tradeATR);
    } else if (
      regimeContext.bias === 'short' &&
      flowImbalance <= -this.params.minFlowImbalance &&
      this.isValidShortRetest(currentKline, tradeEMA, tradeVWAP)
    ) {
      this.armSetup('short', currentKline, tradeATR);
    }

    const armedSetup = this.pendingSetup as PendingRetestSetup | null;
    if (!this.bot.isBackTesting() && armedSetup) {
      logger.debug(
        `[${this.name}] Armed ${armedSetup.side} retest @ ${currentKline.timestamp} | ` +
          `flow=${flowImbalance.toFixed(3)} atrPct=${atrPercent.toFixed(3)}`
      );
    }

    return false;
  }

  private tryBreakRetest(
    currentKline: ALXKline,
    regimeContext: RegimeContext
  ): EnterStrategyActionExecuted | false {
    const setup = this.pendingSetup;
    if (!setup || regimeContext.bias !== setup.side) {
      return false;
    }

    const action =
      setup.side === 'long' && currentKline.close > setup.pullbackHigh
        ? EnterStrategyAction.ENTER_LONG
        : setup.side === 'short' && currentKline.close < setup.pullbackLow
          ? EnterStrategyAction.ENTER_SHORT
          : null;

    if (!action) {
      return false;
    }

    const stopDistanceRate =
      Math.abs(currentKline.close - setup.stopLossPrice) / currentKline.close;
    if (stopDistanceRate > this.params.maxStopDistanceRate) {
      this.pendingSetup = null;
      return false;
    }

    this.pendingSetup = null;

    return {
      kline: currentKline,
      strategyName: this.name,
      params: {
        ...this.params,
        pullbackHigh: setup.pullbackHigh,
        pullbackLow: setup.pullbackLow,
        stopLossPrice: setup.stopLossPrice,
        setupATR: setup.atr,
        stopDistanceRate,
        regimeClose: regimeContext.close,
        regimeVWAP: regimeContext.vwap,
        regimeEMA: regimeContext.ema,
        regimePreviousEMA: regimeContext.prevEma,
        regimeADX: regimeContext.adx,
        regimePreviousADX: regimeContext.prevAdx,
        regimeBias: regimeContext.bias,
      },
      action,
      riskRewardRatio: this.params.riskRewardRatio,
    };
  }

  private armSetup(side: MomentumSide, currentKline: ALXKline, atr: number): void {
    const stopLossPrice =
      side === 'long'
        ? currentKline.low - atr * this.params.stopBufferATRMultiplier
        : currentKline.high + atr * this.params.stopBufferATRMultiplier;

    this.pendingSetup = {
      side,
      armedAtTimestamp: currentKline.timestamp,
      pullbackHigh: currentKline.high,
      pullbackLow: currentKline.low,
      stopLossPrice,
      atr,
    };
  }

  private invalidatePendingSetup(
    currentKline: ALXKline,
    tradeEMA: number,
    tradeVWAP: number,
    regimeBias: RegimeContext['bias']
  ): void {
    if (!this.pendingSetup) {
      return;
    }

    const setup = this.pendingSetup;
    const invalidatedByBias = regimeBias !== setup.side;
    const invalidatedByTradeStructure =
      (setup.side === 'long' && currentKline.close < Math.min(tradeEMA, tradeVWAP)) ||
      (setup.side === 'short' && currentKline.close > Math.max(tradeEMA, tradeVWAP));

    if (invalidatedByBias || invalidatedByTradeStructure) {
      this.pendingSetup = null;
    }
  }

  private isValidLongRetest(currentKline: ALXKline, tradeEMA: number, tradeVWAP: number): boolean {
    const touchedPullbackLevel = currentKline.low <= tradeEMA || currentKline.low <= tradeVWAP;
    const recovered = currentKline.close > Math.min(tradeEMA, tradeVWAP);
    return touchedPullbackLevel && recovered;
  }

  private isValidShortRetest(currentKline: ALXKline, tradeEMA: number, tradeVWAP: number): boolean {
    const touchedPullbackLevel = currentKline.high >= tradeEMA || currentKline.high >= tradeVWAP;
    const rejected = currentKline.close < Math.max(tradeEMA, tradeVWAP);
    return touchedPullbackLevel && rejected;
  }

  private getRegimeContext(): RegimeContext | null {
    const regimeKline = this.bot.exchange
      .getKlinesBuffer(this.bot.config.assetSymbol, this.regimeTimeframe)
      ?.getLast();
    const currentEMA = this.regimeEMA.buffer.getLast();
    const previousEMA = this.regimeEMA.buffer.getAt(-1);
    const currentVWAP = this.regimeVWAP.buffer.getLast()?.vwap;
    const currentADX = this.regimeADX.buffer.getLast()?.adx;
    const previousADX = this.regimeADX.buffer.getAt(-1)?.adx;

    if (
      !regimeKline ||
      !isFiniteNumber(currentEMA) ||
      !isFiniteNumber(previousEMA) ||
      !isFiniteNumber(currentVWAP) ||
      !isFiniteNumber(currentADX) ||
      !isFiniteNumber(previousADX)
    ) {
      return null;
    }

    const longBias =
      regimeKline.close > currentVWAP &&
      currentEMA > previousEMA &&
      currentADX >= this.params.adxThreshold &&
      currentADX >= previousADX;
    const shortBias =
      regimeKline.close < currentVWAP &&
      currentEMA < previousEMA &&
      currentADX >= this.params.adxThreshold &&
      currentADX >= previousADX;

    return {
      close: regimeKline.close,
      vwap: currentVWAP,
      ema: currentEMA,
      prevEma: previousEMA,
      adx: currentADX,
      prevAdx: previousADX,
      bias: longBias ? 'long' : shortBias ? 'short' : 'neutral',
    };
  }

  private getFlowImbalance(klinesBuffer: RollingWindowBuffer<ALXKline>): number | null {
    const lookback = Math.max(1, Math.round(this.params.flowLookback));
    const recentKlines = klinesBuffer.getNLast(lookback);
    const buyCost = recentKlines.reduce((sum, kline) => sum + kline.buyCost, 0);
    const sellCost = recentKlines.reduce((sum, kline) => sum + kline.sellCost, 0);
    const totalCost = buyCost + sellCost;
    if (totalCost <= 0) {
      return null;
    }
    return (buyCost - sellCost) / totalCost;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
