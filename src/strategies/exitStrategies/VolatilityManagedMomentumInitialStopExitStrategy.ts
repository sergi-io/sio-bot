import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { VOLATILITY_MANAGED_MOMENTUM_RETEST_STRATEGY_NAME } from '@/strategies/enterStrategies/VolatilityManagedMomentumRetestEnterStrategy';
import { VOLATILITY_SQUEEZE_BREAKOUT_STRATEGY_NAME } from '@/strategies/enterStrategies/VolatilitySqueezeBreakoutEnterStrategy';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import {
  ExitStrategyAction,
  type EnterStrategyActionExecuted,
  type ExitStrategy,
  type ExitStrategyActionExecuted,
} from '../strategies.types';

export class VolatilityManagedMomentumInitialStopExitStrategy implements ExitStrategy {
  public name: string = 'VolatilityManagedMomentumInitialStopExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.DELTA_KLINE;
  public bot: SioBot;

  constructor(bot: SioBot) {
    this.bot = bot;
  }

  public execute(
    klinesBuffer: RollingWindowBuffer<ALXKline>,
    position: ALXPosition
  ): ExitStrategyActionExecuted | false {
    const latestEntry = this.getLatestSourceEntry(position);
    const currentKline = klinesBuffer.getLast();
    const stopLossPrice = latestEntry?.params.stopLossPrice;

    if (!currentKline || !latestEntry || !isFiniteNumber(stopLossPrice)) {
      return false;
    }

    const stopHit =
      (position.side === ALXPositionSide.LONG && currentKline.low <= stopLossPrice) ||
      (position.side === ALXPositionSide.SHORT && currentKline.high >= stopLossPrice);

    if (!stopHit) {
      return false;
    }

    return {
      strategyName: this.name,
      params: {
        stopLossPrice,
        sourceStrategyName: latestEntry.strategyName,
        sourceEntryTimestamp: latestEntry.kline.timestamp,
      },
      action: ExitStrategyAction.EXIT_CLOSE,
      kline: currentKline,
    };
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
