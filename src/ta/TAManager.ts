import type { ALXKline } from '@/domain/ALXKline';
import type { BufferedIndicator, SimpleBufferedIndicator } from './BufferedIndicator.interfaces';
import type { SioBot } from '@/siobot/SioBot';
import { SioEMA } from './indicators/SioEMA';
import { SioBollingerBands } from './indicators/SioBolingerBands';
import { SioRSI } from './indicators/SioRSI';
import { SioHull } from './indicators/SioHull';
import { SioTrendRibbon } from './indicators/SioTrendRibbon';
import { SioHighLows } from './indicators/SioHighLows';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import { SioChandelier } from './indicators/SioChandelier';
import { SioWMA } from './indicators/SioWMA';
import { SioMTRSuperTrend } from './indicators/SioMTRSuperTrend';
import { SioATR } from './indicators/SioATR';
import { SioADXDI } from './indicators/SioADXDI';
import { SioVWAP } from './indicators/SioVWAP';

export interface RegisteredIndicatorSnapshot {
  id: string;
  bufferSize: number;
  isStable: boolean;
  lastValue: unknown;
}

export class TAManager {
  private indicators: Record<string, BufferedIndicator | SimpleBufferedIndicator>;
  private indicatorsOrder: string[];
  private bot: SioBot;

  constructor(bot: SioBot) {
    this.indicators = {};
    this.indicatorsOrder = [];
    this.bot = bot;
  }

  public genId({
    indicatorName,
    timeFrame,
    assetName,
  }: {
    indicatorName: string;
    timeFrame: string;
    assetName: string;
  }): string {
    return `${indicatorName}_${timeFrame}_${assetName}`;
  }

  private _get<T extends BufferedIndicator | SimpleBufferedIndicator>(id: string): T | null {
    return (this.indicators[id] as T) ?? null;
  }

  private _register(
    indicator: BufferedIndicator | SimpleBufferedIndicator,
    isPriority: boolean = false
  ): void {
    this.indicators[indicator.id] = indicator;
    if (isPriority) {
      this.indicatorsOrder.unshift(indicator.id);
    } else {
      this.indicatorsOrder.push(indicator.id);
    }
  }

  // #################################################################
  // # Public Methods
  // #################################################################

  public addKline(kline: ALXKline): void {
    const klinesBuffer = this.bot.exchange.getKlinesBuffer(kline.pair, kline.timeframe);
    if (!klinesBuffer) {
      throw new Error(`TAManager: Klines buffer not found for symbol ${kline.pair}`);
    }

    this.indicatorsOrder.forEach((indicatorId) => {
      const indicator = this._get(indicatorId);
      if (!indicator) {
        throw new Error(`TAManager: TA Indicator not found for id ${indicatorId}`);
      }
      indicator.addKline(kline, klinesBuffer);
    });
  }

  public getRegisteredIndicatorSnapshots(): RegisteredIndicatorSnapshot[] {
    return this.indicatorsOrder.map((indicatorId) => {
      const indicator = this._get(indicatorId);
      if (!indicator) {
        throw new Error(`TAManager: TA Indicator not found for id ${indicatorId}`);
      }

      return {
        id: indicator.id,
        bufferSize: indicator.buffer.size,
        isStable: indicator.isStable,
        lastValue: indicator.buffer.getLast() ?? null,
      };
    });
  }

  public preloadAllSupportedIndicators(): void {
    const timeFrameToTrade = this.bot.config.timeFrameToTrade;
    this.getHighLows(13, false);
    this.getHighLows(13, true);
    this.getEMA(13, timeFrameToTrade);
    this.getWMA(13, timeFrameToTrade);
    this.getRSI(13, timeFrameToTrade);
    this.getBollingerBands(13, 2, timeFrameToTrade);
    this.getHull(13, timeFrameToTrade);
    this.getTrendRibbon(13, timeFrameToTrade);
    this.getChandelier(13, 1, timeFrameToTrade);
    this.getMTRSuperTrend(13, 9, 4, timeFrameToTrade);
    this.getATR(13, timeFrameToTrade);
    this.getADXDI(13, timeFrameToTrade);
    this.getVWAP(timeFrameToTrade);
  }

  public getHighLows(
    period: number,
    includeCurrentKline: boolean = false,
    timeframe?: ALXTimeFrame
  ): SioHighLows {
    const highLowsId = this.genId({
      indicatorName: `HIGH_LOWS_${period}_${String(includeCurrentKline)}`,
      timeFrame: timeframe ?? this.bot.config.timeFrameToTrade,
      assetName: this.bot.config.assetSymbol,
    });
    let highLows = this.bot.taManager._get<SioHighLows>(highLowsId);
    if (!highLows) {
      highLows = new SioHighLows({
        id: highLowsId,
        period,
        includeCurrentKline,
      });
      // We register as priority since other TAs depend on it
      this._register(highLows, true);
    }
    return highLows;
  }

  public getEMA(period: number, timeframe?: ALXTimeFrame): SioEMA {
    const emaId = this.genId({
      indicatorName: `EMA_${period}`,
      timeFrame: timeframe ?? this.bot.config.timeFrameToTrade,
      assetName: this.bot.config.assetSymbol,
    });

    let ema = this.bot.taManager._get<SioEMA>(emaId);
    if (!ema) {
      ema = new SioEMA({
        id: emaId,
        period,
      });
      this._register(ema);
    }

    return ema;
  }

  public getWMA(period: number, timeframe?: ALXTimeFrame): SioWMA {
    const wmaId = this.genId({
      indicatorName: `WMA_${period}`,
      timeFrame: timeframe ?? this.bot.config.timeFrameToTrade,
      assetName: this.bot.config.assetSymbol,
    });

    let wma = this.bot.taManager._get<SioWMA>(wmaId);
    if (!wma) {
      wma = new SioWMA({
        id: wmaId,
        period,
      });
      this._register(wma);
    }

    return wma;
  }

  public getRSI(period: number, timeframe?: ALXTimeFrame): SioRSI {
    const rsiId = this.genId({
      indicatorName: `RSI_${period}`,
      timeFrame: timeframe ?? this.bot.config.timeFrameToTrade,
      assetName: this.bot.config.assetSymbol,
    });

    let rsi = this.bot.taManager._get<SioRSI>(rsiId);
    if (!rsi) {
      rsi = new SioRSI({
        id: rsiId,
        period,
      });
      this._register(rsi);
    }

    return rsi;
  }

  public getBollingerBands(
    period: number,
    deviationMultiple: number,
    timeframe?: ALXTimeFrame
  ): SioBollingerBands {
    const bbId = this.genId({
      indicatorName: `BOLLINGER_BANDS_${period}_${deviationMultiple}`,
      timeFrame: timeframe ?? this.bot.config.timeFrameToTrade,
      assetName: this.bot.config.assetSymbol,
    });

    let bbands = this.bot.taManager._get<SioBollingerBands>(bbId);
    if (!bbands) {
      bbands = new SioBollingerBands({
        id: bbId,
        period,
        deviationMultiple,
      });
      this._register(bbands);
    }

    return bbands;
  }

  public getHull(period: number, timeframe?: ALXTimeFrame): SioHull {
    const hullId = this.genId({
      indicatorName: `HULL_${period}`,
      timeFrame: timeframe ?? this.bot.config.timeFrameToTrade,
      assetName: this.bot.config.assetSymbol,
    });
    let hull = this.bot.taManager._get<SioHull>(hullId);
    if (!hull) {
      hull = new SioHull({
        id: hullId,
        period,
      });
      this._register(hull);
    }
    return hull;
  }

  public getTrendRibbon(period: number, timeframe?: ALXTimeFrame): SioTrendRibbon {
    const trendRibbonId = this.genId({
      indicatorName: `TREND_RIBBON_${period}`,
      timeFrame: timeframe ?? this.bot.config.timeFrameToTrade,
      assetName: this.bot.config.assetSymbol,
    });
    let trendRibbon = this.bot.taManager._get<SioTrendRibbon>(trendRibbonId);
    if (!trendRibbon) {
      trendRibbon = new SioTrendRibbon({
        id: trendRibbonId,
        period,
        taManager: this,
      });
      this._register(trendRibbon);
    }
    return trendRibbon;
  }

  public getChandelier(
    atrPeriod: number,
    atrMultiplier: number,
    timeframe?: ALXTimeFrame
  ): SioChandelier {
    const chandelierId = this.genId({
      indicatorName: `CHANDELIER_${atrPeriod}_${atrMultiplier}`,
      timeFrame: timeframe ?? this.bot.config.timeFrameToTrade,
      assetName: this.bot.config.assetSymbol,
    });
    let chandelier = this.bot.taManager._get<SioChandelier>(chandelierId);
    if (!chandelier) {
      chandelier = new SioChandelier({
        id: chandelierId,
        atrPeriod,
        atrMultiplier,
      });
      this._register(chandelier);
    }
    return chandelier;
  }

  public getMTRSuperTrend(
    baseLen: number,
    mtrLen: number,
    factor: number,
    timeframe?: ALXTimeFrame
  ): SioMTRSuperTrend {
    const mtrSuperTrendId = this.genId({
      indicatorName: `MTR_SUPERTREND_${baseLen}_${mtrLen}_${factor}`,
      timeFrame: timeframe ?? this.bot.config.timeFrameToTrade,
      assetName: this.bot.config.assetSymbol,
    });
    let mtrSuperTrend = this.bot.taManager._get<SioMTRSuperTrend>(mtrSuperTrendId);
    if (!mtrSuperTrend) {
      mtrSuperTrend = new SioMTRSuperTrend({
        id: mtrSuperTrendId,
        baseLen,
        mtrLen,
        factor,
      });
      this._register(mtrSuperTrend);
    }
    return mtrSuperTrend;
  }

  public getATR(period: number, timeframe?: ALXTimeFrame): SioATR {
    const atrId = this.genId({
      indicatorName: `ATR_${period}`,
      timeFrame: timeframe ?? this.bot.config.timeFrameToTrade,
      assetName: this.bot.config.assetSymbol,
    });

    let atr = this.bot.taManager._get<SioATR>(atrId);
    if (!atr) {
      atr = new SioATR({
        id: atrId,
        period,
      });
      this._register(atr);
    }

    return atr;
  }

  public getADXDI(period: number, timeframe?: ALXTimeFrame): SioADXDI {
    const adxId = this.genId({
      indicatorName: `ADXDI_${period}`,
      timeFrame: timeframe ?? this.bot.config.timeFrameToTrade,
      assetName: this.bot.config.assetSymbol,
    });

    let adxdi = this.bot.taManager._get<SioADXDI>(adxId);
    if (!adxdi) {
      adxdi = new SioADXDI({
        id: adxId,
        period,
      });
      this._register(adxdi);
    }

    return adxdi;
  }

  public getVWAP(timeframe?: ALXTimeFrame): SioVWAP {
    const vwapId = this.genId({
      indicatorName: 'VWAP',
      timeFrame: timeframe ?? this.bot.config.timeFrameToTrade,
      assetName: this.bot.config.assetSymbol,
    });

    let vwap = this.bot.taManager._get<SioVWAP>(vwapId);
    if (!vwap) {
      vwap = new SioVWAP({
        id: vwapId,
      });
      this._register(vwap);
    }

    return vwap;
  }
}
