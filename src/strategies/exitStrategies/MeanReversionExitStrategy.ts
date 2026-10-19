import {
  ExitStrategyAction,
  type ExitStrategyActionExecuted,
  type ExitStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import type { ALXKline } from '@/domain/ALXKline';
import type { ALXPosition } from '@/domain/ALXPosition';
import { ALXPositionSide } from '@/domain/ALXPosition';
import type { BollingerBandsBufferedIndicator } from '@/ta/indicators/SioBolingerBands';
import type { RSIBufferedIndicator } from '@/ta/indicators/SioRSI';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface MeanReversionExitStrategyParams {
  bollingerPeriod: number;
  bollingerStdDev: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
}

export class MeanReversionExitStrategy implements ExitStrategy {
  public name: string = 'MeanReversionExitStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  private params: MeanReversionExitStrategyParams;
  private bollingerBands: BollingerBandsBufferedIndicator;
  private rsi: RSIBufferedIndicator;

  constructor(bot: SioBot, params: MeanReversionExitStrategyParams) {
    this.bot = bot;
    this.params = params;

    this.bollingerBands = this.bot.taManager.getBollingerBands(
      this.params.bollingerPeriod,
      this.params.bollingerStdDev
    );

    this.rsi = this.bot.taManager.getRSI(this.params.rsiPeriod, this.bot.config.timeFrameToTrade);
  }

  public execute(
    klinesBuffer: RollingWindowBuffer<ALXKline>,
    position: ALXPosition
  ): ExitStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      return false;
    }

    const requiredCloses = Math.max(this.params.bollingerPeriod, this.params.rsiPeriod + 1);
    const recentKlines = klinesBuffer.getNLast(requiredCloses);

    if (recentKlines.length < requiredCloses) {
      return false;
    }

    const bollingerBands = this.bollingerBands.buffer.getLast();
    const rsi = this.rsi.buffer.getLast();

    if (bollingerBands === undefined || rsi === undefined) {
      return false;
    }

    const upperBand = bollingerBands.upper;
    const lowerBand = bollingerBands.lower;
    const currentPrice = currentKline.close;

    const exitLong =
      position.side === ALXPositionSide.LONG &&
      currentPrice >= upperBand &&
      rsi >= this.params.rsiOverbought;

    const exitShort =
      position.side === ALXPositionSide.SHORT &&
      currentPrice <= lowerBand &&
      rsi <= this.params.rsiOversold;

    if (!exitLong && !exitShort) {
      return false;
    }

    return {
      strategyName: this.name,
      params: {
        ...this.params,
        indicators: {
          upperBand,
          lowerBand,
          rsi,
          lastClose: currentPrice,
        },
      },
      action: ExitStrategyAction.EXIT_CLOSE,
      kline: currentKline,
    };
  }
}
