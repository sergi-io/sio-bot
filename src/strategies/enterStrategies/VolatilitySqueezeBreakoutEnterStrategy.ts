import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import type { SioADXDI } from '@/ta/indicators/SioADXDI';
import type { SioATR } from '@/ta/indicators/SioATR';
import type { BollingerBandsBufferedIndicator } from '@/ta/indicators/SioBolingerBands';
import type { EMABufferedIndicator } from '@/ta/indicators/SioEMA';
import type { VWAPBufferedIndicator } from '@/ta/indicators/SioVWAP';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import {
  EnterStrategyAction,
  type EnterStrategy,
  type EnterStrategyActionExecuted,
} from '../strategies.types';

export const VOLATILITY_SQUEEZE_BREAKOUT_STRATEGY_NAME = 'VolatilitySqueezeBreakoutEnterStrategy';

interface VolatilitySqueezeBreakoutEnterStrategyParams {
  regimeEMAPeriod: number;
  adxPeriod: number;
  adxThreshold: number;
  atrPeriod: number;
  bollingerPeriod: number;
  bollingerStdDev: number;
  breakoutLookback: number;
  maxCompressionRangeRate: number;
  maxCompressionATRPercent: number;
  maxBollingerBandwidthPercent: number;
  minFlowImbalance: number;
  flowLookback: number;
  stopBufferATRMultiplier: number;
  riskRewardRatio: number;
}

type BreakoutSide = 'long' | 'short';

interface RegimeContext {
  close: number;
  vwap: number;
  ema: number;
  prevEma: number;
  adx: number;
  prevAdx: number;
  bias: BreakoutSide | 'neutral';
}

export class VolatilitySqueezeBreakoutEnterStrategy implements EnterStrategy {
  public name: string = VOLATILITY_SQUEEZE_BREAKOUT_STRATEGY_NAME;
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  public debug: boolean = false;

  private params: VolatilitySqueezeBreakoutEnterStrategyParams;
  private regimeTimeframe: ALXTimeFrame;
  private tradeATR: SioATR;
  private tradeBollingerBands: BollingerBandsBufferedIndicator;
  private regimeEMA: EMABufferedIndicator;
  private regimeVWAP: VWAPBufferedIndicator;
  private regimeADX: SioADXDI;

  constructor(bot: SioBot, params: VolatilitySqueezeBreakoutEnterStrategyParams) {
    this.bot = bot;
    this.params = { ...params };
    this.regimeTimeframe = this.bot.config.timeFrameToDetectRegime;
    this.tradeATR = this.bot.taManager.getATR(
      this.params.atrPeriod,
      this.bot.config.timeFrameToTrade
    );
    this.tradeBollingerBands = this.bot.taManager.getBollingerBands(
      this.params.bollingerPeriod,
      this.params.bollingerStdDev,
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

    const setup = this.getCompressionSetup(klinesBuffer);
    const atr = this.tradeATR.buffer.getAt(-1);
    const bollingerBands = this.tradeBollingerBands.buffer.getAt(-1);
    const regimeContext = this.getRegimeContext();
    const flowImbalance = this.getFlowImbalance(klinesBuffer);

    if (
      !setup ||
      !isFiniteNumber(atr) ||
      !bollingerBands ||
      !regimeContext ||
      regimeContext.bias === 'neutral' ||
      !isFiniteNumber(flowImbalance)
    ) {
      return false;
    }

    const atrPercent = (atr / currentKline.close) * 100;
    const bollingerBandwidthPercent =
      ((bollingerBands.upper - bollingerBands.lower) / currentKline.close) * 100;
    const compressed =
      setup.rangeRate <= this.params.maxCompressionRangeRate &&
      atrPercent <= this.params.maxCompressionATRPercent &&
      bollingerBandwidthPercent <= this.params.maxBollingerBandwidthPercent;

    if (!compressed) {
      return false;
    }

    const longBreakout =
      regimeContext.bias === 'long' &&
      flowImbalance >= this.params.minFlowImbalance &&
      currentKline.close > setup.high;
    const shortBreakout =
      regimeContext.bias === 'short' &&
      flowImbalance <= -this.params.minFlowImbalance &&
      currentKline.close < setup.low;

    const action = longBreakout
      ? EnterStrategyAction.ENTER_LONG
      : shortBreakout
        ? EnterStrategyAction.ENTER_SHORT
        : null;

    if (!action) {
      return false;
    }

    const stopLossPrice =
      action === EnterStrategyAction.ENTER_LONG
        ? setup.low - atr * this.params.stopBufferATRMultiplier
        : setup.high + atr * this.params.stopBufferATRMultiplier;

    return {
      kline: currentKline,
      strategyName: this.name,
      params: {
        ...this.params,
        compressionHigh: setup.high,
        compressionLow: setup.low,
        compressionRangeRate: setup.rangeRate,
        stopLossPrice,
        atr,
        atrPercent,
        bollingerBandwidthPercent,
        flowImbalance,
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

  private getCompressionSetup(
    klinesBuffer: RollingWindowBuffer<ALXKline>
  ): { high: number; low: number; rangeRate: number } | null {
    const lookback = Math.max(2, Math.round(this.params.breakoutLookback));
    const recentKlines = klinesBuffer.getNLast(lookback + 1).slice(0, -1);
    if (recentKlines.length < lookback) {
      return null;
    }

    const high = Math.max(...recentKlines.map((kline) => kline.high));
    const low = Math.min(...recentKlines.map((kline) => kline.low));
    const midpoint = (high + low) / 2;
    if (midpoint <= 0) {
      return null;
    }

    return { high, low, rangeRate: (high - low) / midpoint };
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
