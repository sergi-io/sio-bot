import type { SioBot } from '@/siobot/SioBot';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import type { EMABufferedIndicator } from '@/ta/indicators/SioEMA';
import type { VWAPBufferedIndicator } from '@/ta/indicators/SioVWAP';

export type RegimeBias = 'long' | 'short' | 'neutral';

export class RegimePrefilter {
  private readonly bot: SioBot;
  private readonly timeframe: ALXTimeFrame;
  private readonly regimeEMA: EMABufferedIndicator;
  private readonly regimeVWAP: VWAPBufferedIndicator;

  constructor(bot: SioBot) {
    this.bot = bot;
    this.timeframe = this.bot.config.timeFrameToDetectRegime;
    this.regimeEMA = this.bot.taManager.getEMA(
      this.bot.config.regimePrefilter_EMAPeriod.value,
      this.timeframe
    );
    this.regimeVWAP = this.bot.taManager.getVWAP(this.timeframe);
  }

  public static shouldEnable(bot: SioBot): boolean {
    return (
      bot.config.regimePrefilter_Enabled.value &&
      bot.config.timeFrameToDetectRegime !== bot.config.timeFrameToTrade
    );
  }

  public getBias(): RegimeBias {
    const currentKline = this.bot.exchange
      .getKlinesBuffer(this.bot.config.assetSymbol, this.timeframe)
      ?.getLast();
    const currentEma = this.regimeEMA.buffer.getLast();
    const previousEma = this.regimeEMA.buffer.getAt(-1);
    const currentVwap = this.regimeVWAP.buffer.getLast()?.vwap;

    if (
      !isFiniteNumber(currentKline?.close) ||
      !isFiniteNumber(currentEma) ||
      !isFiniteNumber(previousEma) ||
      !isFiniteNumber(currentVwap)
    ) {
      return 'neutral';
    }

    if (currentKline.close > currentVwap && currentEma > previousEma) {
      return 'long';
    }

    if (currentKline.close < currentVwap && currentEma < previousEma) {
      return 'short';
    }

    return 'neutral';
  }
}

function isFiniteNumber(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
