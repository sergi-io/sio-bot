import { parseDateToMs } from '@/utils/date';
import fs from 'fs';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import { config } from '@/config';
import type { FitnessWeights } from '@/backtester/configOptimizer/ConfigOptimizer';
import { JSON5 } from 'bun';

export enum EventReactStrategy {
  AUTO = 'AUTO', // Decide automatically based on the strategy requirements
  DELTA_KLINE = 'DELTA_KLINE', // Force all strategies to react on every tick
  FULL_KLINE = 'FULL_KLINE', // Force all strategies to react only at the end of the kline
}

export const enum ConfigValueType {
  NUMBER = 'number',
  STRING = 'string',
  BOOLEAN = 'boolean',
  BINARY = 'binary',
}

export interface ConfigNumberValue {
  type: ConfigValueType.NUMBER;
  value: number;
  from: number;
  to: number;
  step: number;
  optimize: boolean;
}

export interface ConfigStringValue {
  type: ConfigValueType.STRING;
  value: string;
  values: string[];
  optimize: boolean;
}

export interface ConfigBooleanValue {
  type: ConfigValueType.BOOLEAN;
  value: boolean;
  optimize: boolean;
}

// When optimizing a ConfigBinaryValue, the value represents the number of bits enabled
// So no boundaries are needed, because it's implicit in the number of bits used
export interface ConfigBinaryValue {
  type: ConfigValueType.BINARY;
  bits: number;
  value: number;
  optimize: boolean;
}

export interface ExchangeFees {
  takerFeeRate: number;
  makerFeeRate: number;
}

export type SerializedBotConfig = Partial<BotConfig>;

const DEFAULT_MIN_FITNESS_FILTER = -1_000_000_000;

interface BotConfigConstructorParams {
  defaultSerializedConfig?: SerializedBotConfig;
}

type ConfigOptimizerGeneticSettings = {
  params: {
    populationSize: number;
    generations: number;
    boundaryDiscoverySamples: number;
    walkForwardFolds: number;
    eliteCount: number;
    mutationRate: number;
    crossoverRate: number;
    tournamentSize: number;
    convergenceLimit: number;
    diversityThreshold: number;
    adaptiveMutation: boolean;
    crossoverType: 'single-point' | 'two-point' | 'uniform';
    mutationStrength: number;
  };
  boundaries: ConfigOptimizerMetricBoundaries;
  weights: Partial<FitnessWeights>;
  filterMinWeights: Partial<FitnessWeights>;
};

export type ConfigOptimizerMetricBoundaries = {
  pnl: { min: number; max: number };
  p10Pnl: { min: number; max: number };
  winRate: { min: number; max: number };
  p50PositionDurationMs: { min: number; max: number };
  numPositions: { min: number; max: number };
  lowerPositionPnl: { min: number; max: number };
  potentialMaxLoss: { min: number; max: number };
  maxPositionDurationMs: { min: number; max: number };
  p95MAE: { min: number; max: number };
};

export class BotConfig {
  // General Config
  timeFramesFromNexus: ALXTimeFrame[] = [];
  timeFrameToTrade: ALXTimeFrame = '' as ALXTimeFrame; // Do not set a default value here do it on loadDefaults Method
  timeFrameToDetectRegime: ALXTimeFrame = '' as ALXTimeFrame;
  assetSymbol: string = '';
  tradeOnDaysBitmask: ConfigBinaryValue = {} as ConfigBinaryValue; // Default: Trade all week (Mon-Fri) (0=Mon,7=Sun)
  numberOfEnterStrategiesToEnter: ConfigNumberValue = {} as ConfigNumberValue;
  eventReactStrategy: ConfigStringValue = {} as ConfigStringValue;
  configOptimizerLoopBackHours: ConfigNumberValue = {} as ConfigNumberValue;
  regimePrefilter_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  regimePrefilter_EMAPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  assetAutoReentryCooldownSeconds: ConfigNumberValue = {} as ConfigNumberValue;
  marketScannerAutoEnter_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  marketScannerAutoEnter_CheckEverySeconds: ConfigNumberValue = {} as ConfigNumberValue;
  marketScannerAutoEnter_MinAbsPriceChange15mPct: ConfigNumberValue = {} as ConfigNumberValue;
  marketScannerAutoEnter_DeltaConfirmationSeconds: ConfigNumberValue = {} as ConfigNumberValue;
  marketScannerAutoEnter_MinVolumeDeltaImbalance: ConfigNumberValue = {} as ConfigNumberValue;
  marketScannerAutoEnter_RiskRewardRatio: ConfigNumberValue = {} as ConfigNumberValue;
  marketScannerLimitOrders_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  marketScannerLimitOrders_OffsetRate: ConfigNumberValue = {} as ConfigNumberValue;
  marketScannerLimitOrders_TakeProfitRiskRewardRatio: ConfigNumberValue = {} as ConfigNumberValue;
  backtestStartTimestampMs: number = parseDateToMs(config.backTest.startDate);
  backtestEndTimestampMs: number = parseDateToMs(config.backTest.endDate);
  configOptimizerGenetic: ConfigOptimizerGeneticSettings = {
    params: {} as ConfigOptimizerGeneticSettings['params'],
    boundaries: {} as ConfigOptimizerMetricBoundaries,
    weights: {},
    filterMinWeights: {},
  };

  // Risk Config
  riskLeverage: ConfigNumberValue = {} as ConfigNumberValue;
  riskMaxConcurrentPositions: ConfigNumberValue = {} as ConfigNumberValue;
  riskMinOrderSizeRate: ConfigNumberValue = {} as ConfigNumberValue;
  riskMaxOrderSizeRate: ConfigNumberValue = {} as ConfigNumberValue;
  riskMaxOrderSizeUSDT: ConfigNumberValue = {} as ConfigNumberValue;

  // DCA Risk Strategy
  dcaRiskStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  dcaRiskStrategy_MaxTimes: ConfigNumberValue = {} as ConfigNumberValue; // Max times dca per symbol (1=no DCA, 2+=DCA)
  dcaRiskStrategy_DropRateThreshold: ConfigNumberValue = {} as ConfigNumberValue; // % loss to trigger DCA (e.g., -10 = -10%)
  dcaRiskStrategy_SizeMultiplier: ConfigNumberValue = {} as ConfigNumberValue; // Multiplier for each DCA level

  // Breakout Stop Loss Risk Strategy
  breakoutStopLossRiskStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  breakoutStopLossRiskStrategy_LoopbackPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  breakoutStopLossRiskStrategy_BreakoutBufferRate: ConfigNumberValue = {} as ConfigNumberValue;

  // Trailing Stop Loss Risk Strategy
  trailingStopLossRiskStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  trailingStopLossRiskStrategy_TrailingOffsetRate: ConfigNumberValue = {} as ConfigNumberValue;

  // Enter Strategies
  adxdiEnterStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  adxdiEnterStrategy_Period: ConfigNumberValue = {} as ConfigNumberValue;
  adxdiEnterStrategy_DISpreadThreshold: ConfigNumberValue = {} as ConfigNumberValue;
  adxdiEnterStrategy_ADX: ConfigNumberValue = {} as ConfigNumberValue;
  adxdiEnterStrategy_RiskRewardRatio: ConfigNumberValue = {} as ConfigNumberValue;
  randomEnterStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  emaEnterStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  emaEnterStrategy_EMAPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  emaEnterStrategy_SlopePeriod: ConfigNumberValue = {} as ConfigNumberValue;
  emaEnterStrategy_WickApproachRate: ConfigNumberValue = {} as ConfigNumberValue;
  emaEnterStrategy_RiskRewardRatio: ConfigNumberValue = {} as ConfigNumberValue;
  crossDoubleEmaEnterStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  crossDoubleEmaEnterStrategy_FastPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  crossDoubleEmaEnterStrategy_SlowPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  crossDoubleEmaEnterStrategy_RiskRewardRatio: ConfigNumberValue = {} as ConfigNumberValue;
  hullTrendRibbonEnterStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  hullTrendRibbonEnterStrategy_HullPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  hullTrendRibbonEnterStrategy_TrendRibbonPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  hullTrendRibbonEnterStrategy_RiskRewardRatio: ConfigNumberValue = {} as ConfigNumberValue;
  hullEnterStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  hullEnterStrategy_HullPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  hullEnterStrategy_RiskRewardRatio: ConfigNumberValue = {} as ConfigNumberValue;
  chandelierTurboWickEnterStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  chandelierTurboWickEnterStrategy_ATRMultiplier: ConfigNumberValue = {} as ConfigNumberValue;
  chandelierTurboWickEnterStrategy_Period: ConfigNumberValue = {} as ConfigNumberValue;
  chandelierTurboWickEnterStrategy_CandleSizeRate: ConfigNumberValue = {} as ConfigNumberValue;
  chandelierTurboWickEnterStrategy_RiskRewardRatio: ConfigNumberValue = {} as ConfigNumberValue;
  chandelierTurboWickEnterStrategy_TimeFrame: ConfigStringValue = {} as ConfigStringValue;
  mtrSuperTrendEnterStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  mtrSuperTrendEnterStrategy_BaseLen: ConfigNumberValue = {} as ConfigNumberValue;
  mtrSuperTrendEnterStrategy_MtrLen: ConfigNumberValue = {} as ConfigNumberValue;
  mtrSuperTrendEnterStrategy_Factor: ConfigNumberValue = {} as ConfigNumberValue;
  mtrSuperTrendEnterStrategy_RiskRewardRatio: ConfigNumberValue = {} as ConfigNumberValue;
  atrVolatilityEnterStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  atrVolatilityEnterStrategy_ATRPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  atrVolatilityEnterStrategy_RiskRewardRatio: ConfigNumberValue = {} as ConfigNumberValue;
  atrVolatilityEnterStrategy_ATRMultiplier: ConfigNumberValue = {} as ConfigNumberValue;
  microTrendRetestBreakEnterStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  microTrendRetestBreakEnterStrategy_EMAFastPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  microTrendRetestBreakEnterStrategy_EMASlowPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  microTrendRetestBreakEnterStrategy_ADXPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  microTrendRetestBreakEnterStrategy_ADX: ConfigNumberValue = {} as ConfigNumberValue;
  microTrendRetestBreakEnterStrategy_RiskRewardRatio: ConfigNumberValue = {} as ConfigNumberValue;
  volatilityManagedMomentumRetestEnterStrategy_Enabled: ConfigBooleanValue =
    {} as ConfigBooleanValue;
  volatilityManagedMomentumRetestEnterStrategy_RegimeEMAPeriod: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilityManagedMomentumRetestEnterStrategy_PullbackEMAPeriod: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilityManagedMomentumRetestEnterStrategy_ADXPeriod: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilityManagedMomentumRetestEnterStrategy_ADX: ConfigNumberValue = {} as ConfigNumberValue;
  volatilityManagedMomentumRetestEnterStrategy_ATRPeriod: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilityManagedMomentumRetestEnterStrategy_MinATRPercent: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilityManagedMomentumRetestEnterStrategy_MaxATRPercent: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilityManagedMomentumRetestEnterStrategy_MinFlowImbalance: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilityManagedMomentumRetestEnterStrategy_FlowLookback: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilityManagedMomentumRetestEnterStrategy_StopBufferATRMultiplier: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilityManagedMomentumRetestEnterStrategy_MaxStopDistanceRate: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilityManagedMomentumRetestEnterStrategy_RiskRewardRatio: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  volatilitySqueezeBreakoutEnterStrategy_RegimeEMAPeriod: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_ADXPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_ADX: ConfigNumberValue = {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_ATRPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_BollingerPeriod: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_BollingerStdDev: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_BreakoutLookback: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_MaxCompressionRangeRate: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_MaxCompressionATRPercent: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_MaxBollingerBandwidthPercent: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_MinFlowImbalance: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_FlowLookback: ConfigNumberValue = {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_StopBufferATRMultiplier: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilitySqueezeBreakoutEnterStrategy_RiskRewardRatio: ConfigNumberValue =
    {} as ConfigNumberValue;
  // Exit Strategies
  durationExitStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  durationExitStrategy_MaxTimeHoldingSeconds: ConfigNumberValue = {} as ConfigNumberValue;
  profitExitStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  profitExitStrategy_ProfitToExit: ConfigNumberValue = {} as ConfigNumberValue;
  breakEvenExitStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  breakEvenExitStrategy_ProfitToActivate: ConfigNumberValue = {} as ConfigNumberValue;
  breakEvenExitStrategy_ProfitToProtect: ConfigNumberValue = {} as ConfigNumberValue;
  breakEvenExitStrategy_MaxGivebackRate: ConfigNumberValue = {} as ConfigNumberValue;
  riskRewardRatioExitStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  riskRewardRatioExitStrategy_StopLossThresholdRate: ConfigNumberValue = {} as ConfigNumberValue;
  stopLossExitStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  stopLossExitStrategy_MaxLoss: ConfigNumberValue = {} as ConfigNumberValue;
  stopLossMAEExitStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  stopLossMAEExitStrategy_MAEThreshold: ConfigNumberValue = {} as ConfigNumberValue;
  stopLossMAEExitStrategy_MaxMAE: ConfigNumberValue = {} as ConfigNumberValue;
  stopLossSupportResistanceExitStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  stopLossSupportResistanceExitStrategy_PastKlinesToCheck: ConfigNumberValue =
    {} as ConfigNumberValue;
  microTrendRetestBreakStopLossExitStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  volatilityManagedMomentumInitialStopExitStrategy_Enabled: ConfigBooleanValue =
    {} as ConfigBooleanValue;
  volatilityManagedMomentumTrailExitStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  volatilityManagedMomentumTrailExitStrategy_EMAPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  volatilityManagedMomentumTrailExitStrategy_ATRPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  volatilityManagedMomentumTrailExitStrategy_ATRTrailingMultiplier: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilityManagedMomentumTrailExitStrategy_TrailingActivationR: ConfigNumberValue =
    {} as ConfigNumberValue;
  volatilityManagedMomentumTrailExitStrategy_ExitOnVWAPAndEMALoss: ConfigBooleanValue =
    {} as ConfigBooleanValue;
  crossDoubleEmaExitStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  crossDoubleEmaExitStrategy_FastPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  crossDoubleEmaExitStrategy_SlowPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  meanReversionExitStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  meanReversionExitStrategy_BollingerPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  meanReversionExitStrategy_BollingerStdDev: ConfigNumberValue = {} as ConfigNumberValue;
  meanReversionExitStrategy_RSIPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  meanReversionExitStrategy_RSIOverbought: ConfigNumberValue = {} as ConfigNumberValue;
  meanReversionExitStrategy_RSIOversold: ConfigNumberValue = {} as ConfigNumberValue;
  hullTrendRibbonExitStrategy_Enabled: ConfigBooleanValue = {} as ConfigBooleanValue;
  hullTrendRibbonExitStrategy_HullPeriod: ConfigNumberValue = {} as ConfigNumberValue;
  hullTrendRibbonExitStrategy_TrendRibbonPeriod: ConfigNumberValue = {} as ConfigNumberValue;

  constructor({ defaultSerializedConfig }: BotConfigConstructorParams = {}) {
    this.loadDefaults();
    if (defaultSerializedConfig) {
      this.setSerializedConfig(defaultSerializedConfig);
    }
  }

  /** These are the default values for the bot configuration
   * These values are overridden when loading from a file or setting serialized config
   */
  private loadDefaults(): void {
    // Touching this might require to touch @config.buffer.size in src/config.ts
    // Only change it if you see that the bot timeouts while warming up buffers
    this.timeFramesFromNexus = ['1m', '5m', '15m', '30m', '4h', '1d'];
    this.timeFrameToTrade = '5m';
    this.timeFrameToDetectRegime = this.timeFrameToTrade;
    this.assetSymbol = 'SOLUSDT';
    this.backtestStartTimestampMs = parseDateToMs(config.backTest.startDate);
    this.backtestEndTimestampMs = parseDateToMs(config.backTest.endDate);

    this.tradeOnDaysBitmask = {
      type: ConfigValueType.BINARY,
      value: 0b1111111,
      bits: 7,
      optimize: false,
    }; // Trade all week (Mon-Sun) (0=Mon,7=Sun)
    this.configOptimizerLoopBackHours = {
      type: ConfigValueType.NUMBER,
      value: 48,
      from: 24,
      to: 1440,
      step: 24,
      optimize: false,
    };
    this.regimePrefilter_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: true,
      optimize: false,
    };
    this.regimePrefilter_EMAPeriod = {
      type: ConfigValueType.NUMBER,
      value: 100,
      from: 50,
      to: 250,
      step: 10,
      optimize: false,
    };
    this.assetAutoReentryCooldownSeconds = {
      type: ConfigValueType.NUMBER,
      value: 60,
      from: 0,
      to: 3600,
      step: 5,
      optimize: false,
    };
    this.marketScannerAutoEnter_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.marketScannerAutoEnter_CheckEverySeconds = {
      type: ConfigValueType.NUMBER,
      value: 60,
      from: 15,
      to: 300,
      step: 15,
      optimize: false,
    };
    this.marketScannerAutoEnter_MinAbsPriceChange15mPct = {
      type: ConfigValueType.NUMBER,
      value: 1,
      from: 0.1,
      to: 10,
      step: 0.1,
      optimize: false,
    };
    this.marketScannerAutoEnter_DeltaConfirmationSeconds = {
      type: ConfigValueType.NUMBER,
      value: 3,
      from: 0,
      to: 15,
      step: 1,
      optimize: false,
    };
    this.marketScannerAutoEnter_MinVolumeDeltaImbalance = {
      type: ConfigValueType.NUMBER,
      value: 0.08,
      from: 0,
      to: 1,
      step: 0.01,
      optimize: false,
    };
    this.marketScannerAutoEnter_RiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 0,
      from: 0,
      to: 6,
      step: 0.5,
      optimize: false,
    };
    this.marketScannerLimitOrders_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.marketScannerLimitOrders_OffsetRate = {
      type: ConfigValueType.NUMBER,
      value: 0.001,
      from: 0,
      to: 0.02,
      step: 0.0005,
      optimize: false,
    };
    this.marketScannerLimitOrders_TakeProfitRiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 2,
      from: 0,
      to: 6,
      step: 0.5,
      optimize: false,
    };
    this.configOptimizerGenetic = this.createDefaultConfigOptimizerGenetic();

    this.numberOfEnterStrategiesToEnter = {
      type: ConfigValueType.NUMBER,
      value: 1,
      from: 1,
      to: 2,
      step: 1,
      optimize: false,
    };

    // Risk Manager Config
    this.riskLeverage = {
      type: ConfigValueType.NUMBER,
      value: 1,
      from: 1,
      to: 10,
      step: 1,
      optimize: false,
    };
    this.riskMaxConcurrentPositions = {
      type: ConfigValueType.NUMBER,
      value: 1,
      from: 1,
      to: 5,
      step: 1,
      optimize: false,
    };
    this.riskMinOrderSizeRate = {
      type: ConfigValueType.NUMBER,
      value: 1,
      from: 0.05,
      to: 1,
      step: 0.05,
      optimize: false,
    };
    this.riskMaxOrderSizeRate = {
      type: ConfigValueType.NUMBER,
      value: 1,
      from: 0.05,
      to: 1,
      step: 0.05,
      optimize: false,
    };
    this.riskMaxOrderSizeUSDT = {
      type: ConfigValueType.NUMBER,
      value: 1000,
      from: 25,
      to: 1000,
      step: 25,
      optimize: false,
    };

    // DCA Risk Strategy Defaults
    this.dcaRiskStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.dcaRiskStrategy_MaxTimes = {
      type: ConfigValueType.NUMBER,
      value: 3, // Max 3 positions per symbol (initial + 2 DCA)
      from: 2,
      to: 5,
      step: 1,
      optimize: false,
    };
    this.dcaRiskStrategy_DropRateThreshold = {
      type: ConfigValueType.NUMBER,
      value: -10, // Trigger DCA when position is -10% of margin
      from: -5,
      to: -30,
      step: -5,
      optimize: false,
    };
    this.dcaRiskStrategy_SizeMultiplier = {
      type: ConfigValueType.NUMBER,
      value: 1.5, // Each DCA is 1.5x the previous
      from: 1.0,
      to: 3.0,
      step: 0.5,
      optimize: false,
    };

    // Trailing Stop Loss Risk Strategy Defaults
    this.trailingStopLossRiskStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.trailingStopLossRiskStrategy_TrailingOffsetRate = {
      type: ConfigValueType.NUMBER,
      value: 0.01, // 1% trailing stop loss
      from: 0.001,
      to: 0.051,
      step: 0.005,
      optimize: false,
    };
    this.breakoutStopLossRiskStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.breakoutStopLossRiskStrategy_LoopbackPeriod = {
      type: ConfigValueType.NUMBER,
      value: 20,
      from: 4,
      to: 50,
      step: 2,
      optimize: false,
    };
    this.breakoutStopLossRiskStrategy_BreakoutBufferRate = {
      type: ConfigValueType.NUMBER,
      value: 0.005,
      from: 0,
      to: 0.05,
      step: 0.005,
      optimize: false,
    };
    this.eventReactStrategy = {
      type: ConfigValueType.STRING,
      value: EventReactStrategy.FULL_KLINE,
      values: [
        EventReactStrategy.AUTO,
        EventReactStrategy.DELTA_KLINE,
        EventReactStrategy.FULL_KLINE,
      ],
      optimize: false,
    };

    // Exit Strategies Enabled
    this.profitExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: true,
      optimize: false,
    };
    this.breakEvenExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.riskRewardRatioExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.riskRewardRatioExitStrategy_StopLossThresholdRate = {
      type: ConfigValueType.NUMBER,
      value: 0.01,
      from: 0.005,
      to: 0.05,
      step: 0.005,
      optimize: false,
    };
    this.stopLossExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.stopLossMAEExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.stopLossSupportResistanceExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.microTrendRetestBreakStopLossExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.volatilityManagedMomentumInitialStopExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.volatilityManagedMomentumTrailExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.volatilityManagedMomentumTrailExitStrategy_ExitOnVWAPAndEMALoss = {
      type: ConfigValueType.BOOLEAN,
      value: true,
      optimize: false,
    };
    this.stopLossMAEExitStrategy_MAEThreshold = {
      type: ConfigValueType.NUMBER,
      value: 5,
      from: 0,
      to: 75,
      step: 5,
      optimize: false,
    };
    this.stopLossMAEExitStrategy_MaxMAE = {
      type: ConfigValueType.NUMBER,
      value: 50,
      from: 0,
      to: 100,
      step: 5,
      optimize: false,
    };
    this.durationExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.crossDoubleEmaExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.meanReversionExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.hullTrendRibbonExitStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };

    // Enter Strategies Enabled
    this.adxdiEnterStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.randomEnterStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.emaEnterStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.crossDoubleEmaEnterStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.hullTrendRibbonEnterStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.hullEnterStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.chandelierTurboWickEnterStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.mtrSuperTrendEnterStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.atrVolatilityEnterStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.microTrendRetestBreakEnterStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.volatilityManagedMomentumRetestEnterStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_Enabled = {
      type: ConfigValueType.BOOLEAN,
      value: false,
      optimize: false,
    };

    // Exit Strategies Config Params
    // #################################################################
    // # DurationExitStrategy
    // #################################################################
    this.durationExitStrategy_MaxTimeHoldingSeconds = {
      type: ConfigValueType.NUMBER,
      value: 1 * 60 * 60 * 24, // 1 day
      from: 1 * 60 * 60,
      to: 7 * 24 * 60 * 60,
      step: 6 * 60 * 60,
      optimize: false,
    };
    // #################################################################
    // # ProfitExitStrategy
    // #################################################################
    this.profitExitStrategy_ProfitToExit = {
      type: ConfigValueType.NUMBER,
      value: 60.0,
      from: 5,
      to: 200,
      step: 5,
      optimize: false,
    };
    // #################################################################
    // # BreakEvenExitStrategy
    // #################################################################
    this.breakEvenExitStrategy_ProfitToActivate = {
      type: ConfigValueType.NUMBER,
      value: 30,
      from: 10,
      to: 120,
      step: 5,
      optimize: false,
    };
    this.breakEvenExitStrategy_ProfitToProtect = {
      type: ConfigValueType.NUMBER,
      value: 10,
      from: 0,
      to: 80,
      step: 5,
      optimize: false,
    };
    this.breakEvenExitStrategy_MaxGivebackRate = {
      type: ConfigValueType.NUMBER,
      value: 0.5,
      from: 0,
      to: 1,
      step: 0.05,
      optimize: false,
    };
    // #################################################################
    // # StopLossExitStrategy
    // #################################################################
    this.stopLossExitStrategy_MaxLoss = {
      type: ConfigValueType.NUMBER,
      value: -50,
      from: -10,
      to: -200,
      step: -10,
      optimize: false,
    };
    // #################################################################
    // # StopLossSupportResistanceExitStrategy
    // #################################################################
    this.stopLossSupportResistanceExitStrategy_PastKlinesToCheck = {
      type: ConfigValueType.NUMBER,
      value: 20,
      from: 5,
      to: 50,
      step: 5,
      optimize: false,
    };
    // #################################################################
    // # VolatilityManagedMomentumTrailExitStrategy
    // #################################################################
    this.volatilityManagedMomentumTrailExitStrategy_EMAPeriod = {
      type: ConfigValueType.NUMBER,
      value: 20,
      from: 8,
      to: 56,
      step: 2,
      optimize: false,
    };
    this.volatilityManagedMomentumTrailExitStrategy_ATRPeriod = {
      type: ConfigValueType.NUMBER,
      value: 14,
      from: 7,
      to: 35,
      step: 2,
      optimize: false,
    };
    this.volatilityManagedMomentumTrailExitStrategy_ATRTrailingMultiplier = {
      type: ConfigValueType.NUMBER,
      value: 2.5,
      from: 1.0,
      to: 5.0,
      step: 0.5,
      optimize: false,
    };
    this.volatilityManagedMomentumTrailExitStrategy_TrailingActivationR = {
      type: ConfigValueType.NUMBER,
      value: 1.0,
      from: 0.5,
      to: 3.0,
      step: 0.5,
      optimize: false,
    };
    // #################################################################
    // # CrossDoubleEmaExitStrategy
    // #################################################################
    this.crossDoubleEmaExitStrategy_FastPeriod = {
      type: ConfigValueType.NUMBER,
      value: 40,
      from: 5,
      to: 50,
      step: 5,
      optimize: false,
    };
    this.crossDoubleEmaExitStrategy_SlowPeriod = {
      type: ConfigValueType.NUMBER,
      value: 96,
      from: 40,
      to: 160,
      step: 5,
      optimize: false,
    };
    // #################################################################
    // # MeanReversionExitStrategy
    // #################################################################
    this.meanReversionExitStrategy_BollingerPeriod = {
      type: ConfigValueType.NUMBER,
      value: 54,
      from: 9,
      to: 59,
      step: 5,
      optimize: false,
    };
    this.meanReversionExitStrategy_BollingerStdDev = {
      type: ConfigValueType.NUMBER,
      value: 2,
      from: 1,
      to: 3,
      step: 0.25,
      optimize: false,
    };
    this.meanReversionExitStrategy_RSIPeriod = {
      type: ConfigValueType.NUMBER,
      value: 28,
      from: 8,
      to: 32,
      step: 2,
      optimize: false,
    };
    this.meanReversionExitStrategy_RSIOverbought = {
      type: ConfigValueType.NUMBER,
      value: 62,
      from: 56,
      to: 80,
      step: 2,
      optimize: false,
    };
    this.meanReversionExitStrategy_RSIOversold = {
      type: ConfigValueType.NUMBER,
      value: 30,
      from: 20,
      to: 48,
      step: 2,
      optimize: false,
    };
    // #################################################################
    // # HullTrendRibbonExitStrategy
    // #################################################################
    this.hullTrendRibbonExitStrategy_HullPeriod = {
      type: ConfigValueType.NUMBER,
      value: 70,
      from: 10,
      to: 100,
      step: 5,
      optimize: false,
    };
    this.hullTrendRibbonExitStrategy_TrendRibbonPeriod = {
      type: ConfigValueType.NUMBER,
      value: 20,
      from: 5,
      to: 50,
      step: 5,
      optimize: false,
    };

    // Enter Strategies Config Params
    // #################################################################
    // # ADXDIEnterStrategy
    // #################################################################
    this.adxdiEnterStrategy_Period = {
      type: ConfigValueType.NUMBER,
      value: 14,
      from: 5,
      to: 30,
      step: 1,
      optimize: false,
    };
    this.adxdiEnterStrategy_DISpreadThreshold = {
      type: ConfigValueType.NUMBER,
      value: 2,
      from: 0,
      to: 25,
      step: 1,
      optimize: false,
    };
    this.adxdiEnterStrategy_ADX = {
      type: ConfigValueType.NUMBER,
      value: 20,
      from: 12,
      to: 35,
      step: 1,
      optimize: false,
    };
    this.adxdiEnterStrategy_RiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 1.0,
      from: 1.0,
      to: 5.0,
      step: 0.5,
      optimize: false,
    };

    // #################################################################
    // # EmaEnterStrategy
    // #################################################################
    this.emaEnterStrategy_EMAPeriod = {
      type: ConfigValueType.NUMBER,
      value: 28.0,
      from: 2,
      to: 30,
      step: 1,
      optimize: false,
    };
    this.emaEnterStrategy_SlopePeriod = {
      type: ConfigValueType.NUMBER,
      value: 15.0,
      from: 1,
      to: 50,
      step: 2,
      optimize: false,
    };
    this.emaEnterStrategy_WickApproachRate = {
      type: ConfigValueType.NUMBER,
      value: 0.08,
      from: 0.05,
      to: 0.1,
      step: 0.01,
      optimize: false,
    };
    this.emaEnterStrategy_RiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 1.0,
      from: 1.0,
      to: 5.0,
      step: 0.5,
      optimize: false,
    };
    // #################################################################
    // # CrossDoubleEmaEnterStrategy
    // #################################################################
    this.crossDoubleEmaEnterStrategy_FastPeriod = {
      type: ConfigValueType.NUMBER,
      value: 28,
      from: 5,
      to: 40,
      step: 1,
      optimize: false,
    };
    this.crossDoubleEmaEnterStrategy_SlowPeriod = {
      type: ConfigValueType.NUMBER,
      value: 50,
      from: 50,
      to: 170,
      step: 4,
      optimize: false,
    };
    this.crossDoubleEmaEnterStrategy_RiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 1.0,
      from: 1.0,
      to: 5.0,
      step: 0.5,
      optimize: false,
    };
    // #################################################################
    // # HullTrendRibbonEnterStrategy
    // #################################################################
    this.hullTrendRibbonEnterStrategy_HullPeriod = {
      type: ConfigValueType.NUMBER,
      value: 70,
      from: 10,
      to: 100,
      step: 5,
      optimize: false,
    };
    this.hullTrendRibbonEnterStrategy_TrendRibbonPeriod = {
      type: ConfigValueType.NUMBER,
      value: 20,
      from: 5,
      to: 50,
      step: 5,
      optimize: false,
    };
    this.hullTrendRibbonEnterStrategy_RiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 1.0,
      from: 1.0,
      to: 5.0,
      step: 0.5,
      optimize: false,
    };
    // #################################################################
    // # HullEnterStrategy
    // #################################################################
    this.hullEnterStrategy_HullPeriod = {
      type: ConfigValueType.NUMBER,
      value: 20,
      from: 5,
      to: 50,
      step: 5,
      optimize: false,
    };
    this.hullEnterStrategy_RiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 1.0,
      from: 1.0,
      to: 5.0,
      step: 0.5,
      optimize: false,
    };
    // #################################################################
    // # chandelierTurboWickEnterStrategy
    // #################################################################
    this.chandelierTurboWickEnterStrategy_ATRMultiplier = {
      type: ConfigValueType.NUMBER,
      value: 1,
      from: 1,
      to: 3,
      step: 1,
      optimize: false,
    };
    this.chandelierTurboWickEnterStrategy_Period = {
      type: ConfigValueType.NUMBER,
      value: 22,
      from: 5,
      to: 50,
      step: 5,
      optimize: false,
    };
    this.chandelierTurboWickEnterStrategy_CandleSizeRate = {
      type: ConfigValueType.NUMBER,
      value: 0.75,
      from: 0,
      to: 1,
      step: 0.05,
      optimize: false,
    };
    this.chandelierTurboWickEnterStrategy_RiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 1.0,
      from: 1.0,
      to: 3.0,
      step: 0.5,
      optimize: false,
    };
    this.chandelierTurboWickEnterStrategy_TimeFrame = {
      type: ConfigValueType.STRING,
      value: '5m',
      values: ['1m', '5m', '15m', '30m', '1h'],
      optimize: false,
    };
    // #################################################################
    // # MTRSuperTrendEnterStrategy
    // #################################################################
    this.mtrSuperTrendEnterStrategy_BaseLen = {
      type: ConfigValueType.NUMBER,
      value: 7,
      from: 3,
      to: 20,
      step: 1,
      optimize: false,
    };
    this.mtrSuperTrendEnterStrategy_MtrLen = {
      type: ConfigValueType.NUMBER,
      value: 10,
      from: 3,
      to: 20,
      step: 1,
      optimize: false,
    };
    this.mtrSuperTrendEnterStrategy_Factor = {
      type: ConfigValueType.NUMBER,
      value: 2.2,
      from: 1.0,
      to: 4.0,
      step: 0.1,
      optimize: false,
    };
    this.mtrSuperTrendEnterStrategy_RiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 1.0,
      from: 1.0,
      to: 5.0,
      step: 0.5,
      optimize: false,
    };
    // #################################################################
    // # ATRVolatilityEnterStrategy
    // #################################################################
    this.atrVolatilityEnterStrategy_ATRPeriod = {
      type: ConfigValueType.NUMBER,
      value: 14,
      from: 6,
      to: 34,
      step: 2,
      optimize: false,
    };
    this.atrVolatilityEnterStrategy_RiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 1.0,
      from: 1.0,
      to: 5.0,
      step: 0.5,
      optimize: false,
    };
    this.atrVolatilityEnterStrategy_ATRMultiplier = {
      type: ConfigValueType.NUMBER,
      value: 1.5,
      from: 1.0,
      to: 4.0,
      step: 0.5,
      optimize: false,
    };
    // #################################################################
    // # MicroTrendRetestBreakEnterStrategy
    // #################################################################
    this.microTrendRetestBreakEnterStrategy_EMAFastPeriod = {
      type: ConfigValueType.NUMBER,
      value: 20,
      from: 5,
      to: 60,
      step: 5,
      optimize: false,
    };
    this.microTrendRetestBreakEnterStrategy_EMASlowPeriod = {
      type: ConfigValueType.NUMBER,
      value: 50,
      from: 40,
      to: 240,
      step: 5,
      optimize: false,
    };
    this.microTrendRetestBreakEnterStrategy_ADXPeriod = {
      type: ConfigValueType.NUMBER,
      value: 14,
      from: 7,
      to: 45,
      step: 2,
      optimize: false,
    };
    this.microTrendRetestBreakEnterStrategy_ADX = {
      type: ConfigValueType.NUMBER,
      value: 18,
      from: 12,
      to: 35,
      step: 1,
      optimize: false,
    };
    this.microTrendRetestBreakEnterStrategy_RiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 1.0,
      from: 1.0,
      to: 6.0,
      step: 0.5,
      optimize: false,
    };
    // #################################################################
    // # VolatilityManagedMomentumRetestEnterStrategy
    // #################################################################
    this.volatilityManagedMomentumRetestEnterStrategy_RegimeEMAPeriod = {
      type: ConfigValueType.NUMBER,
      value: 100,
      from: 50,
      to: 250,
      step: 10,
      optimize: false,
    };
    this.volatilityManagedMomentumRetestEnterStrategy_PullbackEMAPeriod = {
      type: ConfigValueType.NUMBER,
      value: 20,
      from: 8,
      to: 56,
      step: 2,
      optimize: false,
    };
    this.volatilityManagedMomentumRetestEnterStrategy_ADXPeriod = {
      type: ConfigValueType.NUMBER,
      value: 14,
      from: 7,
      to: 45,
      step: 2,
      optimize: false,
    };
    this.volatilityManagedMomentumRetestEnterStrategy_ADX = {
      type: ConfigValueType.NUMBER,
      value: 22,
      from: 10,
      to: 45,
      step: 1,
      optimize: false,
    };
    this.volatilityManagedMomentumRetestEnterStrategy_ATRPeriod = {
      type: ConfigValueType.NUMBER,
      value: 14,
      from: 7,
      to: 35,
      step: 2,
      optimize: false,
    };
    this.volatilityManagedMomentumRetestEnterStrategy_MinATRPercent = {
      type: ConfigValueType.NUMBER,
      value: 0.05,
      from: 0,
      to: 0.3,
      step: 0.025,
      optimize: false,
    };
    this.volatilityManagedMomentumRetestEnterStrategy_MaxATRPercent = {
      type: ConfigValueType.NUMBER,
      value: 2.5,
      from: 0.5,
      to: 5,
      step: 0.25,
      optimize: false,
    };
    this.volatilityManagedMomentumRetestEnterStrategy_MinFlowImbalance = {
      type: ConfigValueType.NUMBER,
      value: 0.03,
      from: 0,
      to: 0.3,
      step: 0.025,
      optimize: false,
    };
    this.volatilityManagedMomentumRetestEnterStrategy_FlowLookback = {
      type: ConfigValueType.NUMBER,
      value: 3,
      from: 1,
      to: 12,
      step: 1,
      optimize: false,
    };
    this.volatilityManagedMomentumRetestEnterStrategy_StopBufferATRMultiplier = {
      type: ConfigValueType.NUMBER,
      value: 0.25,
      from: 0,
      to: 1.5,
      step: 0.25,
      optimize: false,
    };
    this.volatilityManagedMomentumRetestEnterStrategy_MaxStopDistanceRate = {
      type: ConfigValueType.NUMBER,
      value: 0.025,
      from: 0.005,
      to: 0.08,
      step: 0.005,
      optimize: false,
    };
    this.volatilityManagedMomentumRetestEnterStrategy_RiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 2.5,
      from: 1.0,
      to: 6.0,
      step: 0.5,
      optimize: false,
    };
    // #################################################################
    // # VolatilitySqueezeBreakoutEnterStrategy
    // #################################################################
    this.volatilitySqueezeBreakoutEnterStrategy_RegimeEMAPeriod = {
      type: ConfigValueType.NUMBER,
      value: 100,
      from: 50,
      to: 250,
      step: 10,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_ADXPeriod = {
      type: ConfigValueType.NUMBER,
      value: 14,
      from: 7,
      to: 45,
      step: 2,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_ADX = {
      type: ConfigValueType.NUMBER,
      value: 20,
      from: 10,
      to: 45,
      step: 1,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_ATRPeriod = {
      type: ConfigValueType.NUMBER,
      value: 14,
      from: 7,
      to: 35,
      step: 2,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_BollingerPeriod = {
      type: ConfigValueType.NUMBER,
      value: 20,
      from: 10,
      to: 60,
      step: 2,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_BollingerStdDev = {
      type: ConfigValueType.NUMBER,
      value: 2,
      from: 1,
      to: 3,
      step: 0.25,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_BreakoutLookback = {
      type: ConfigValueType.NUMBER,
      value: 24,
      from: 8,
      to: 60,
      step: 2,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_MaxCompressionRangeRate = {
      type: ConfigValueType.NUMBER,
      value: 0.025,
      from: 0.005,
      to: 0.08,
      step: 0.005,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_MaxCompressionATRPercent = {
      type: ConfigValueType.NUMBER,
      value: 0.45,
      from: 0.05,
      to: 2,
      step: 0.1,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_MaxBollingerBandwidthPercent = {
      type: ConfigValueType.NUMBER,
      value: 2.5,
      from: 0.5,
      to: 8,
      step: 0.25,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_MinFlowImbalance = {
      type: ConfigValueType.NUMBER,
      value: 0.02,
      from: 0,
      to: 0.3,
      step: 0.025,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_FlowLookback = {
      type: ConfigValueType.NUMBER,
      value: 3,
      from: 1,
      to: 12,
      step: 1,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_StopBufferATRMultiplier = {
      type: ConfigValueType.NUMBER,
      value: 0.5,
      from: 0,
      to: 2,
      step: 0.25,
      optimize: false,
    };
    this.volatilitySqueezeBreakoutEnterStrategy_RiskRewardRatio = {
      type: ConfigValueType.NUMBER,
      value: 3.0,
      from: 1.0,
      to: 6.0,
      step: 0.5,
      optimize: false,
    };
  }

  private createDefaultConfigOptimizerGenetic(): ConfigOptimizerGeneticSettings {
    return {
      params: {
        populationSize: 200,
        generations: 400,
        eliteCount: 5, // 2.5%
        mutationRate: 0.1,
        crossoverRate: 0.85,
        tournamentSize: 3,
        convergenceLimit: 50,
        diversityThreshold: 0.35,
        adaptiveMutation: true,
        crossoverType: 'uniform',
        mutationStrength: 0.25,
        boundaryDiscoverySamples: 1500,
        walkForwardFolds: 1,
      },
      boundaries: {
        pnl: { min: -1000, max: 2000 },
        p10Pnl: { min: -250, max: 500 },
        winRate: { min: 0, max: 100 },
        numPositions: { min: 0, max: 250 },
        p50PositionDurationMs: { min: 0, max: 7 * 24 * 60 * 60 * 1000 },
        maxPositionDurationMs: { min: 0, max: 30 * 24 * 60 * 60 * 1000 },
        lowerPositionPnl: { min: -500, max: 100 },
        potentialMaxLoss: { min: -5000, max: 0 },
        p95MAE: { min: -100, max: 0 },
      },
      weights: {
        pnl: 0.3,
        p10Pnl: 0.1,
        sharpeRatio: 0.05,
        profitFactor: 0.2,
        winRate: 0.25,
        numPositions: 0,
        p50PositionDurationMs: 0,
        maxPositionDurationMs: 0,
        lowerPositionPnl: 0,
        potentialMaxLoss: 0,
        p95MAE: 0.1,
      },
      filterMinWeights: {
        pnl: 0,
        p10Pnl: -50,
        sharpeRatio: 0,
        profitFactor: 1.05,
        winRate: 45,
        numPositions: 30,
        p50PositionDurationMs: DEFAULT_MIN_FITNESS_FILTER,
        maxPositionDurationMs: DEFAULT_MIN_FITNESS_FILTER,
        lowerPositionPnl: -120,
        potentialMaxLoss: -500,
        p95MAE: DEFAULT_MIN_FITNESS_FILTER,
      },
    };
  }

  private mergeConfigOptimizerBoundaries(
    defaults: ConfigOptimizerMetricBoundaries,
    current: Partial<ConfigOptimizerMetricBoundaries> | undefined
  ): ConfigOptimizerMetricBoundaries {
    return {
      pnl: { ...defaults.pnl, ...current?.pnl },
      p10Pnl: { ...defaults.p10Pnl, ...current?.p10Pnl },
      winRate: { ...defaults.winRate, ...current?.winRate },
      p50PositionDurationMs: {
        ...defaults.p50PositionDurationMs,
        ...current?.p50PositionDurationMs,
      },
      numPositions: { ...defaults.numPositions, ...current?.numPositions },
      lowerPositionPnl: { ...defaults.lowerPositionPnl, ...current?.lowerPositionPnl },
      potentialMaxLoss: { ...defaults.potentialMaxLoss, ...current?.potentialMaxLoss },
      maxPositionDurationMs: {
        ...defaults.maxPositionDurationMs,
        ...current?.maxPositionDurationMs,
      },
      p95MAE: { ...defaults.p95MAE, ...current?.p95MAE },
    };
  }

  private normalizeConfigOptimizerGenetic(): void {
    const defaults = this.createDefaultConfigOptimizerGenetic();
    const current = (this.configOptimizerGenetic ??
      defaults) as Partial<ConfigOptimizerGeneticSettings>;
    const currentParams = (current.params ?? {}) as Partial<
      ConfigOptimizerGeneticSettings['params']
    >;

    this.configOptimizerGenetic = {
      ...defaults,
      ...current,
      params: {
        ...defaults.params,
        ...currentParams,
      },
      boundaries: this.mergeConfigOptimizerBoundaries(defaults.boundaries, current.boundaries),
      weights: current.weights ?? defaults.weights,
      filterMinWeights: current.filterMinWeights ?? defaults.filterMinWeights,
    };
  }

  private applyTimeFrameFallbacks(hasExplicitRegimeTimeframe: boolean): void {
    if (!hasExplicitRegimeTimeframe) {
      this.timeFrameToDetectRegime = this.timeFrameToTrade;
    }
  }

  public setSerializedConfig(serializedConfig: SerializedBotConfig): void {
    const hasExplicitRegimeTimeframe = Object.prototype.hasOwnProperty.call(
      serializedConfig,
      'timeFrameToDetectRegime'
    );

    Object.keys(serializedConfig).forEach((key) => {
      const k = key as keyof BotConfig;
      const v = serializedConfig[k];

      const configValue = this[k];

      if (v === undefined) {
        return;
      }

      if (typeof configValue === 'object' && configValue !== null && 'value' in configValue) {
        if (typeof v === 'object') {
          // @ts-expect-error Don't want to type this more strictly right now
          this[k].value = v.value as any;
        } else {
          // @ts-expect-error Don't want to type this more strictly right now
          this[k].value = v as any;
        }
      } else {
        // @ts-expect-error Don't want to type this more strictly right now
        this[k] = v as any;
      }
    });

    this.normalizeConfigOptimizerGenetic();
    this.applyTimeFrameFallbacks(hasExplicitRegimeTimeframe);
  }

  public getSerializedConfig(): SerializedBotConfig {
    const serializedConfig: SerializedBotConfig = {};
    Object.keys(this).forEach((key) => {
      const k = key as keyof BotConfig;
      const configValue = this[k];

      if (configValue === undefined) {
        return;
      }

      if (typeof configValue === 'object' && configValue !== null && 'value' in configValue) {
        // @ts-expect-error Don't want to type this more strictly right now
        serializedConfig[k] = configValue.value;
      } else {
        // @ts-expect-error Don't want to type this more strictly right now
        serializedConfig[k] = configValue;
      }
    });

    return serializedConfig;
  }

  public saveToFile(filePath: string): void {
    const serializedConfig: Record<string, unknown> = {};

    Object.keys(this).forEach((key) => {
      const k = key as keyof BotConfig;
      const configValue = this[k];

      if (configValue === undefined) {
        return;
      }

      const isObjectWithValue =
        typeof configValue === 'object' &&
        configValue !== null &&
        'value' in configValue &&
        configValue.value !== undefined;
      const hasOptimize =
        typeof configValue === 'object' && configValue !== null && 'optimize' in configValue;

      if (isObjectWithValue && hasOptimize) {
        const cv = configValue as { value: unknown; optimize: boolean };
        const prefix = cv.optimize ? '1|' : '0|';
        serializedConfig[`${prefix}${key}`] = cv.value;
      } else if (isObjectWithValue) {
        const cv = configValue as { value: unknown };
        serializedConfig[key] = cv.value;
      } else {
        serializedConfig[key] = configValue;
      }
    });

    const data = JSON.stringify(serializedConfig, null, 2);
    fs.writeFileSync(filePath, data, 'utf-8');
  }

  public loadFromFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`BotConfig loadFromFile: File does not exist: ${filePath}`);
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsedData = JSON5.parse(data) as Record<string, unknown>;
    const hasExplicitRegimeTimeframe = Object.prototype.hasOwnProperty.call(
      parsedData,
      'timeFrameToDetectRegime'
    );

    Object.keys(parsedData).forEach((rawKey) => {
      let key: string;
      let optimize: boolean | undefined;

      if (rawKey.startsWith('1|')) {
        key = rawKey.slice(2);
        optimize = true;
      } else if (rawKey.startsWith('0|')) {
        key = rawKey.slice(2);
        optimize = false;
      } else {
        key = rawKey;
        optimize = undefined;
      }

      const k = key as keyof BotConfig;
      const value = parsedData[rawKey];
      const configValue = this[k];

      if (typeof configValue === 'object' && configValue !== null && 'value' in configValue) {
        // @ts-expect-error Don't want to type this more strictly right now
        this[k].value = value;
        if (optimize !== undefined && 'optimize' in configValue) {
          // @ts-expect-error Don't want to type this more strictly right now
          this[k].optimize = optimize;
        }
      } else {
        // @ts-expect-error Don't want to type this more strictly right now
        this[k] = value;
      }
    });

    this.normalizeConfigOptimizerGenetic();
    this.applyTimeFrameFallbacks(hasExplicitRegimeTimeframe);
  }
}
