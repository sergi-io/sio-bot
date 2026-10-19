import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { VOLATILITY_MANAGED_MOMENTUM_RETEST_STRATEGY_NAME } from '@/strategies/enterStrategies/VolatilityManagedMomentumRetestEnterStrategy';
import { VOLATILITY_SQUEEZE_BREAKOUT_STRATEGY_NAME } from '@/strategies/enterStrategies/VolatilitySqueezeBreakoutEnterStrategy';
import type { SioATR } from '@/ta/indicators/SioATR';
import type { EMABufferedIndicator } from '@/ta/indicators/SioEMA';
import type { VWAPBufferedIndicator } from '@/ta/indicators/SioVWAP';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import {
  ExitStrategyAction,
  type EnterStrategyActionExecuted,
  type ExitStrategy,
  type ExitStrategyActionExecuted,
} from '../strategies.types';

interface VolatilityManagedMomentumTrailExitStrategyParams {
  pullbackEMAPeriod: number;
  atrPeriod: number;
  atrTrailingMultiplier: number;
  trailingActivationR: number;
  exitOnVWAPAndEMALoss: boolean;
}

export class VolatilityManagedMomentumTrailExitStrategy implements ExitStrategy {
  public name: string = 'VolatilityManagedMomentumTrailExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;

  private params: VolatilityManagedMomentumTrailExitStrategyParams;
  private tradeEMA: EMABufferedIndicator;
  private tradeVWAP: VWAPBufferedIndicator;
  private tradeATR: SioATR;

  constructor(bot: SioBot, params: VolatilityManagedMomentumTrailExitStrategyParams) {
    this.bot = bot;
    this.params = { ...params };
    this.tradeEMA = this.bot.taManager.getEMA(
      this.params.pullbackEMAPeriod,
      this.bot.config.timeFrameToTrade
    );
    this.tradeVWAP = this.bot.taManager.getVWAP(this.bot.config.timeFrameToTrade);
    this.tradeATR = this.bot.taManager.getATR(
      this.params.atrPeriod,
      this.bot.config.timeFrameToTrade
    );
  }

  public execute(
    klinesBuffer: RollingWindowBuffer<ALXKline>,
    position: ALXPosition
  ): ExitStrategyActionExecuted | false {
    const latestEntry = this.getLatestSourceEntry(position);
    const currentKline = klinesBuffer.getLast();
    if (!latestEntry || !currentKline) {
      return false;
    }

    const sourceStopLossPrice = latestEntry.params.stopLossPrice;
    const initialRisk = Math.abs(position.entryPrice - sourceStopLossPrice);
    const atr = this.tradeATR.buffer.getLast();
    const ema = this.tradeEMA.buffer.getLast();
    const vwap = this.tradeVWAP.buffer.getLast()?.vwap;

    if (
      !isFiniteNumber(sourceStopLossPrice) ||
      !isFiniteNumber(initialRisk) ||
      initialRisk <= 0 ||
      !isFiniteNumber(atr) ||
      !isFiniteNumber(ema) ||
      !isFiniteNumber(vwap)
    ) {
      return false;
    }

    const currentR = this.getCurrentR(position, currentKline.close, initialRisk);
    const trendExit = this.params.exitOnVWAPAndEMALoss && this.hasLostTrend(position, currentKline);
    const trailExit = this.getTrailExit(klinesBuffer, position, atr, currentR);

    if (!trendExit && !trailExit) {
      return false;
    }

    return {
      strategyName: this.name,
      params: {
        ...this.params,
        sourceStrategyName: latestEntry.strategyName,
        sourceEntryTimestamp: latestEntry.kline.timestamp,
        sourceStopLossPrice,
        initialRisk,
        currentR,
        atr,
        ema,
        vwap,
        trailingStopPrice: trailExit?.trailingStopPrice,
        exitReason: trailExit ? 'atr_trailing_stop' : 'vwap_ema_loss',
      },
      action: ExitStrategyAction.EXIT_CLOSE,
      kline: currentKline,
    };
  }

  private getTrailExit(
    klinesBuffer: RollingWindowBuffer<ALXKline>,
    position: ALXPosition,
    atr: number,
    currentR: number
  ): { trailingStopPrice: number } | null {
    if (currentR < this.params.trailingActivationR) {
      return null;
    }

    const klinesSinceOpen = klinesBuffer
      .toArray()
      .filter((kline) => kline.timestamp >= position.openTimestamp);
    const currentKline = klinesBuffer.getLast();

    if (!currentKline || klinesSinceOpen.length === 0) {
      return null;
    }

    const trailingDistance = atr * this.params.atrTrailingMultiplier;
    const trailingStopPrice =
      position.side === ALXPositionSide.LONG
        ? Math.max(...klinesSinceOpen.map((kline) => kline.high)) - trailingDistance
        : Math.min(...klinesSinceOpen.map((kline) => kline.low)) + trailingDistance;
    const stopHit =
      (position.side === ALXPositionSide.LONG && currentKline.low <= trailingStopPrice) ||
      (position.side === ALXPositionSide.SHORT && currentKline.high >= trailingStopPrice);

    return stopHit ? { trailingStopPrice } : null;
  }

  private hasLostTrend(position: ALXPosition, currentKline: ALXKline): boolean {
    const ema = this.tradeEMA.buffer.getLast();
    const vwap = this.tradeVWAP.buffer.getLast()?.vwap;
    if (!isFiniteNumber(ema) || !isFiniteNumber(vwap)) {
      return false;
    }

    return (
      (position.side === ALXPositionSide.LONG &&
        currentKline.close < ema &&
        currentKline.close < vwap) ||
      (position.side === ALXPositionSide.SHORT &&
        currentKline.close > ema &&
        currentKline.close > vwap)
    );
  }

  private getCurrentR(position: ALXPosition, currentPrice: number, initialRisk: number): number {
    const favorableMove =
      position.side === ALXPositionSide.LONG
        ? currentPrice - position.entryPrice
        : position.entryPrice - currentPrice;
    return favorableMove / initialRisk;
  }

  private getLatestSourceEntry(position: ALXPosition): EnterStrategyActionExecuted | null {
    const sourceStrategyNames = new Set([
      VOLATILITY_MANAGED_MOMENTUM_RETEST_STRATEGY_NAME,
      VOLATILITY_SQUEEZE_BREAKOUT_STRATEGY_NAME,
    ]);
    const matchingEntries =
      position.openedByStrategies?.filter(
        (entry) =>
          sourceStrategyNames.has(entry.strategyName) && entry.kline?.pair === position.symbol
      ) ?? [];

    if (matchingEntries.length === 0) {
      return null;
    }

    const firstEntry = matchingEntries[0];
    if (!firstEntry) {
      return null;
    }

    return matchingEntries.reduce((latest, entry) => {
      return entry.kline.timestamp > latest.kline.timestamp ? entry : latest;
    }, firstEntry);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
