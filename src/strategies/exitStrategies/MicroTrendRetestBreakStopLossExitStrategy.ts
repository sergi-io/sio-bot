import type { SioBot } from '@/siobot/SioBot';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import {
  ExitStrategyAction,
  type EnterStrategyActionExecuted,
  type ExitStrategy,
  type ExitStrategyActionExecuted,
} from '../strategies.types';

const SOURCE_STRATEGY_NAME = 'MicroTrendRetestBreakEnterStrategy';

export class MicroTrendRetestBreakStopLossExitStrategy implements ExitStrategy {
  public name: string = 'MicroTrendRetestBreakStopLossExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.DELTA_KLINE;
  public bot: SioBot;

  constructor(bot: SioBot) {
    this.bot = bot;
  }

  public execute(
    klinesBuffer: RollingWindowBuffer<ALXKline>,
    position: ALXPosition
  ): ExitStrategyActionExecuted | false {
    const latestEntry = this.getLatestMicroTrendEntry(position);
    if (!latestEntry) {
      return false;
    }

    const stopLossPrice = latestEntry.params.informationalStopLossPrice;
    const pullbackHigh = latestEntry.params.pullbackHigh;
    const pullbackLow = latestEntry.params.pullbackLow;
    const currentKline = klinesBuffer.getLast();

    if (
      !currentKline ||
      !isFiniteNumber(stopLossPrice) ||
      !isFiniteNumber(pullbackHigh) ||
      !isFiniteNumber(pullbackLow)
    ) {
      return false;
    }

    const stopLossHit =
      (position.side === ALXPositionSide.LONG && currentKline.low <= stopLossPrice) ||
      (position.side === ALXPositionSide.SHORT && currentKline.high >= stopLossPrice);

    if (!stopLossHit) {
      return false;
    }

    return {
      strategyName: this.name,
      params: {
        stopLossPrice,
        pullbackHigh,
        pullbackLow,
        sourceStrategyName: latestEntry.strategyName,
        sourceEntryTimestamp: latestEntry.kline.timestamp,
      },
      action: ExitStrategyAction.EXIT_CLOSE,
      kline: currentKline,
    };
  }

  private getLatestMicroTrendEntry(position: ALXPosition): EnterStrategyActionExecuted | null {
    const matchingEntries =
      position.openedByStrategies?.filter(
        (entry) => entry.strategyName === SOURCE_STRATEGY_NAME && entry.kline?.pair === position.symbol
      ) ?? [];

    if (matchingEntries.length === 0) {
      return null;
    }

    return matchingEntries.reduce((latest, entry) => {
      if (!latest) {
        return entry;
      }

      return entry.kline.timestamp > latest.kline.timestamp ? entry : latest;
    }, matchingEntries[0] ?? null);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
