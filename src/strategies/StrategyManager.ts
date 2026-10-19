import type { SioBot } from '@/siobot/SioBot';
import {
  EnterStrategyAction,
  ExitStrategyAction,
  type EnterStrategyActionExecuted,
  type EnterStrategy,
  type ExitStrategy,
} from './strategies.types';
import { EMAEnterStrategy } from './enterStrategies/EmaEnterStrategy';
import type { ALXKline } from '@/domain/ALXKline';
import { EventReactStrategy } from '@/siobot/BotConfig';
import { logger, silentLogger } from '@/utils/logger';
import { ProfitExitStrategy } from './exitStrategies/ProfitExitStrategy';
import { DurationExitStrategy } from './exitStrategies/DurationExitStrategy';
import { StopLossExitStrategy } from './exitStrategies/StopLossExitStrategy';
import { MeanReversionExitStrategy } from './exitStrategies/MeanReversionExitStrategy';
import { CrossDoubleEMAEnterStrategy } from './enterStrategies/CrossDoubleEmaEnterStrategy';
import { CrossDoubleEMAExitStrategy } from './exitStrategies/CrossDoubleEmaExitStrategy';
import { HullTrendRibbonEnterStrategy } from './enterStrategies/HullTrendRibbonEnterStrategy';
import { HullTrendRibbonExitStrategy } from './exitStrategies/HullTrendRibbonExitStrategy';
import { ChandelierTurboWickEnterStrategy } from './enterStrategies/ChandelierTurboWickEnterStrategy';
import { StopLossMAEExitStrategy } from './exitStrategies/StopLossMAEExitStrategy';
import { RiskRewardRatioExitStrategy } from './exitStrategies/RiskRewardRatioExitStrategy';
import { HullEnterStrategy } from './enterStrategies/HullEnterStrategy';
import { MTRSuperTrendEnterStrategy } from './enterStrategies/MTRSuperTrendEnterStrategy';
import { ATRVolatilityEnterStrategy } from './enterStrategies/ATRVolatilityEnterStrategy';
import { TrailingStopLossExitStrategy } from './exitStrategies/TrailingStopLossExitStrategy';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import { RandomEnterStrategy } from './enterStrategies/RandomEnterStrategy';
import { BreakoutStopLossExitStrategy } from './exitStrategies/BreakoutStopLossExitStrategy';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';
import { ADXDIEnterStrategy } from './enterStrategies/ADXDIEnterStrategy';
import { BreakEvenExitStrategy } from './exitStrategies/BreakEvenExitStrategy';
import { StopLossSupportResistanceExitStrategy } from './exitStrategies/StopLossSupportResistanceExitStrategy';
import { MicroTrendRetestBreakEnterStrategy } from './enterStrategies/MicroTrendRetestBreakEnterStrategy';
import { MicroTrendRetestBreakStopLossExitStrategy } from './exitStrategies/MicroTrendRetestBreakStopLossExitStrategy';
import { RegimePrefilter } from './RegimePrefilter';
import { VolatilityManagedMomentumRetestEnterStrategy } from './enterStrategies/VolatilityManagedMomentumRetestEnterStrategy';
import { VolatilityManagedMomentumInitialStopExitStrategy } from './exitStrategies/VolatilityManagedMomentumInitialStopExitStrategy';
import { VolatilityManagedMomentumTrailExitStrategy } from './exitStrategies/VolatilityManagedMomentumTrailExitStrategy';
import { VolatilitySqueezeBreakoutEnterStrategy } from './enterStrategies/VolatilitySqueezeBreakoutEnterStrategy';

export class StrategyManager {
  private bot: SioBot;
  private enterStrategies: EnterStrategy[] = [];
  private exitStrategies: ExitStrategy[] = [];
  private regimePrefilter: RegimePrefilter | null = null;
  private logger: typeof logger = logger;

  constructor(bot: SioBot) {
    this.bot = bot;
    if (this.bot.isBackTesting()) {
      this.logger = silentLogger as typeof logger;
    }
    if (RegimePrefilter.shouldEnable(this.bot)) {
      this.regimePrefilter = new RegimePrefilter(this.bot);
    }
    this.registerEnterStrategies();
    this.registerExitStrategies();
  }

  private registerEnterStrategies(): void {
    // #################################################################
    // # ADXDIEnterStrategy
    // #################################################################
    if (this.bot.config.adxdiEnterStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering ADXDIEnterStrategy');
      this.enterStrategies.push(
        new ADXDIEnterStrategy(this.bot, {
          period: this.bot.config.adxdiEnterStrategy_Period.value,
          diSpreadThreshold: this.bot.config.adxdiEnterStrategy_DISpreadThreshold.value,
          adx: this.bot.config.adxdiEnterStrategy_ADX.value,
          riskRewardRatio: this.bot.config.adxdiEnterStrategy_RiskRewardRatio.value,
        })
      );
    }

    // #################################################################
    // # RandomEnterStrategy
    // #################################################################
    if (this.bot.config.randomEnterStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering RandomEnterStrategy');
      this.enterStrategies.push(new RandomEnterStrategy(this.bot));
    }
    // #################################################################
    // # EMAEnterStrategy
    // #################################################################
    if (this.bot.config.emaEnterStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering EMAEnterStrategy');
      this.enterStrategies.push(
        new EMAEnterStrategy(this.bot, {
          emaPeriod: this.bot.config.emaEnterStrategy_EMAPeriod.value,
          slopePeriod: this.bot.config.emaEnterStrategy_SlopePeriod.value,
          wickApproachRate: this.bot.config.emaEnterStrategy_WickApproachRate.value,
          riskRewardRatio: this.bot.config.emaEnterStrategy_RiskRewardRatio.value,
        })
      );
    }

    // #################################################################
    // # DoubleEMAEnterStrategy
    // #################################################################
    if (this.bot.config.crossDoubleEmaEnterStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering DoubleEMAEnterStrategy');
      this.enterStrategies.push(
        new CrossDoubleEMAEnterStrategy(this.bot, {
          fastPeriod: this.bot.config.crossDoubleEmaEnterStrategy_FastPeriod.value,
          slowPeriod: this.bot.config.crossDoubleEmaEnterStrategy_SlowPeriod.value,
          riskRewardRatio: this.bot.config.crossDoubleEmaEnterStrategy_RiskRewardRatio.value,
        })
      );
    }
    // #################################################################
    // # HullTrendRibbonEnterStrategy
    // #################################################################
    if (this.bot.config.hullTrendRibbonEnterStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering HullTrendRibbonEnterStrategy');
      this.enterStrategies.push(
        new HullTrendRibbonEnterStrategy(this.bot, {
          trendRibbonPeriod: this.bot.config.hullTrendRibbonEnterStrategy_TrendRibbonPeriod.value,
          hullPeriod: this.bot.config.hullTrendRibbonEnterStrategy_HullPeriod.value,
          riskRewardRatio: this.bot.config.hullTrendRibbonEnterStrategy_RiskRewardRatio.value,
        })
      );
    }
    // #################################################################
    // # HullEnterStrategy
    // #################################################################
    if (this.bot.config.hullEnterStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering HullEnterStrategy');
      this.enterStrategies.push(
        new HullEnterStrategy(this.bot, {
          hullPeriod: this.bot.config.hullEnterStrategy_HullPeriod.value,
          riskRewardRatio: this.bot.config.hullEnterStrategy_RiskRewardRatio.value,
        })
      );
    }
    // #################################################################
    // # ChandelierTurboWickEnterStrategy
    // #################################################################
    if (this.bot.config.chandelierTurboWickEnterStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering ChandelierTurboWickEnterStrategy');
      this.enterStrategies.push(
        new ChandelierTurboWickEnterStrategy(this.bot, {
          period: this.bot.config.chandelierTurboWickEnterStrategy_Period.value,
          atrMultiplier: this.bot.config.chandelierTurboWickEnterStrategy_ATRMultiplier.value,
          candleSizeRate: this.bot.config.chandelierTurboWickEnterStrategy_CandleSizeRate.value,
          riskRewardRatio: this.bot.config.chandelierTurboWickEnterStrategy_RiskRewardRatio.value,
          timeFrame: this.bot.config.chandelierTurboWickEnterStrategy_TimeFrame
            .value as ALXTimeFrame,
        })
      );
    }
    // #################################################################
    // # MTRSuperTrendEnterStrategy
    // #################################################################
    if (this.bot.config.mtrSuperTrendEnterStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering MTRSuperTrendEnterStrategy');
      this.enterStrategies.push(
        new MTRSuperTrendEnterStrategy(this.bot, {
          baseLen: this.bot.config.mtrSuperTrendEnterStrategy_BaseLen.value,
          mtrLen: this.bot.config.mtrSuperTrendEnterStrategy_MtrLen.value,
          factor: this.bot.config.mtrSuperTrendEnterStrategy_Factor.value,
          riskRewardRatio: this.bot.config.mtrSuperTrendEnterStrategy_RiskRewardRatio.value,
        })
      );
    }
    // #################################################################
    // # ATRVolatilityEnterStrategy
    // #################################################################
    if (this.bot.config.atrVolatilityEnterStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering ATRVolatilityEnterStrategy');
      this.enterStrategies.push(
        new ATRVolatilityEnterStrategy(this.bot, {
          atrPeriod: this.bot.config.atrVolatilityEnterStrategy_ATRPeriod.value,
          riskRewardRatio: this.bot.config.atrVolatilityEnterStrategy_RiskRewardRatio.value,
          atrMultiplier: this.bot.config.atrVolatilityEnterStrategy_ATRMultiplier.value,
        })
      );
    }
    // #################################################################
    // # MicroTrendRetestBreakEnterStrategy
    // #################################################################
    if (this.bot.config.microTrendRetestBreakEnterStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering MicroTrendRetestBreakEnterStrategy');
      this.enterStrategies.push(
        new MicroTrendRetestBreakEnterStrategy(this.bot, {
          emaFastPeriod: this.bot.config.microTrendRetestBreakEnterStrategy_EMAFastPeriod.value,
          emaSlowPeriod: this.bot.config.microTrendRetestBreakEnterStrategy_EMASlowPeriod.value,
          adxPeriod: this.bot.config.microTrendRetestBreakEnterStrategy_ADXPeriod.value,
          adxThreshold: this.bot.config.microTrendRetestBreakEnterStrategy_ADX.value,
          riskRewardRatio: this.bot.config.microTrendRetestBreakEnterStrategy_RiskRewardRatio.value,
        })
      );
    }
    // #################################################################
    // # VolatilityManagedMomentumRetestEnterStrategy
    // #################################################################
    if (this.bot.config.volatilityManagedMomentumRetestEnterStrategy_Enabled.value) {
      this.logger.info(
        '⚙️ StrategyManager: Registering VolatilityManagedMomentumRetestEnterStrategy'
      );
      this.enterStrategies.push(
        new VolatilityManagedMomentumRetestEnterStrategy(this.bot, {
          regimeEMAPeriod:
            this.bot.config.volatilityManagedMomentumRetestEnterStrategy_RegimeEMAPeriod.value,
          pullbackEMAPeriod:
            this.bot.config.volatilityManagedMomentumRetestEnterStrategy_PullbackEMAPeriod.value,
          adxPeriod: this.bot.config.volatilityManagedMomentumRetestEnterStrategy_ADXPeriod.value,
          adxThreshold: this.bot.config.volatilityManagedMomentumRetestEnterStrategy_ADX.value,
          atrPeriod: this.bot.config.volatilityManagedMomentumRetestEnterStrategy_ATRPeriod.value,
          minATRPercent:
            this.bot.config.volatilityManagedMomentumRetestEnterStrategy_MinATRPercent.value,
          maxATRPercent:
            this.bot.config.volatilityManagedMomentumRetestEnterStrategy_MaxATRPercent.value,
          minFlowImbalance:
            this.bot.config.volatilityManagedMomentumRetestEnterStrategy_MinFlowImbalance.value,
          flowLookback:
            this.bot.config.volatilityManagedMomentumRetestEnterStrategy_FlowLookback.value,
          stopBufferATRMultiplier:
            this.bot.config.volatilityManagedMomentumRetestEnterStrategy_StopBufferATRMultiplier
              .value,
          maxStopDistanceRate:
            this.bot.config.volatilityManagedMomentumRetestEnterStrategy_MaxStopDistanceRate.value,
          riskRewardRatio:
            this.bot.config.volatilityManagedMomentumRetestEnterStrategy_RiskRewardRatio.value,
        })
      );
    }
    // #################################################################
    // # VolatilitySqueezeBreakoutEnterStrategy
    // #################################################################
    if (this.bot.config.volatilitySqueezeBreakoutEnterStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering VolatilitySqueezeBreakoutEnterStrategy');
      this.enterStrategies.push(
        new VolatilitySqueezeBreakoutEnterStrategy(this.bot, {
          regimeEMAPeriod:
            this.bot.config.volatilitySqueezeBreakoutEnterStrategy_RegimeEMAPeriod.value,
          adxPeriod: this.bot.config.volatilitySqueezeBreakoutEnterStrategy_ADXPeriod.value,
          adxThreshold: this.bot.config.volatilitySqueezeBreakoutEnterStrategy_ADX.value,
          atrPeriod: this.bot.config.volatilitySqueezeBreakoutEnterStrategy_ATRPeriod.value,
          bollingerPeriod:
            this.bot.config.volatilitySqueezeBreakoutEnterStrategy_BollingerPeriod.value,
          bollingerStdDev:
            this.bot.config.volatilitySqueezeBreakoutEnterStrategy_BollingerStdDev.value,
          breakoutLookback:
            this.bot.config.volatilitySqueezeBreakoutEnterStrategy_BreakoutLookback.value,
          maxCompressionRangeRate:
            this.bot.config.volatilitySqueezeBreakoutEnterStrategy_MaxCompressionRangeRate.value,
          maxCompressionATRPercent:
            this.bot.config.volatilitySqueezeBreakoutEnterStrategy_MaxCompressionATRPercent.value,
          maxBollingerBandwidthPercent:
            this.bot.config.volatilitySqueezeBreakoutEnterStrategy_MaxBollingerBandwidthPercent
              .value,
          minFlowImbalance:
            this.bot.config.volatilitySqueezeBreakoutEnterStrategy_MinFlowImbalance.value,
          flowLookback: this.bot.config.volatilitySqueezeBreakoutEnterStrategy_FlowLookback.value,
          stopBufferATRMultiplier:
            this.bot.config.volatilitySqueezeBreakoutEnterStrategy_StopBufferATRMultiplier.value,
          riskRewardRatio:
            this.bot.config.volatilitySqueezeBreakoutEnterStrategy_RiskRewardRatio.value,
        })
      );
    }
  }

  private registerExitStrategies(): void {
    // #################################################################
    // # TrailingStopLossExitStrategy
    // # This strategy is enabled transitively if TrailingStopLossRiskStrategy is enabled
    // #################################################################

    if (this.bot.config.trailingStopLossRiskStrategy_Enabled.value) {
      this.logger.info(
        '⚙️ StrategyManager: Registering TrailingStopLossExitStrategy (linked to TrailingStopLossRiskStrategy)'
      );
      this.exitStrategies.push(new TrailingStopLossExitStrategy(this.bot));
    }
    // #################################################################
    // # MicroTrendRetestBreakStopLossExitStrategy
    // #################################################################
    if (this.bot.config.microTrendRetestBreakStopLossExitStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering MicroTrendRetestBreakStopLossExitStrategy');
      this.exitStrategies.push(new MicroTrendRetestBreakStopLossExitStrategy(this.bot));
    }
    // #################################################################
    // # VolatilityManagedMomentumInitialStopExitStrategy
    // #################################################################
    if (this.bot.config.volatilityManagedMomentumInitialStopExitStrategy_Enabled.value) {
      this.logger.info(
        '⚙️ StrategyManager: Registering VolatilityManagedMomentumInitialStopExitStrategy'
      );
      this.exitStrategies.push(new VolatilityManagedMomentumInitialStopExitStrategy(this.bot));
    }
    // #################################################################
    // # VolatilityManagedMomentumTrailExitStrategy
    // #################################################################
    if (this.bot.config.volatilityManagedMomentumTrailExitStrategy_Enabled.value) {
      this.logger.info(
        '⚙️ StrategyManager: Registering VolatilityManagedMomentumTrailExitStrategy'
      );
      this.exitStrategies.push(
        new VolatilityManagedMomentumTrailExitStrategy(this.bot, {
          pullbackEMAPeriod:
            this.bot.config.volatilityManagedMomentumTrailExitStrategy_EMAPeriod.value,
          atrPeriod: this.bot.config.volatilityManagedMomentumTrailExitStrategy_ATRPeriod.value,
          atrTrailingMultiplier:
            this.bot.config.volatilityManagedMomentumTrailExitStrategy_ATRTrailingMultiplier.value,
          trailingActivationR:
            this.bot.config.volatilityManagedMomentumTrailExitStrategy_TrailingActivationR.value,
          exitOnVWAPAndEMALoss:
            this.bot.config.volatilityManagedMomentumTrailExitStrategy_ExitOnVWAPAndEMALoss.value,
        })
      );
    }

    // #################################################################
    // # ProfitExitStrategy
    // #################################################################
    if (this.bot.config.profitExitStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering ProfitExitStrategy');
      this.exitStrategies.push(
        new ProfitExitStrategy(this.bot, {
          profitToExit: this.bot.config.profitExitStrategy_ProfitToExit.value,
        })
      );
    }
    // #################################################################
    // # BreakEvenExitStrategy
    // #################################################################
    if (this.bot.config.breakEvenExitStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering BreakEvenExitStrategy');
      this.exitStrategies.push(
        new BreakEvenExitStrategy(this.bot, {
          profitToActivate: this.bot.config.breakEvenExitStrategy_ProfitToActivate.value,
          profitToProtect: this.bot.config.breakEvenExitStrategy_ProfitToProtect.value,
          maxGivebackRate: this.bot.config.breakEvenExitStrategy_MaxGivebackRate.value,
        })
      );
    }
    // #################################################################
    // # RiskRewardRatioExitStrategy
    // #################################################################
    if (this.bot.config.riskRewardRatioExitStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering RiskRewardRatioExitStrategy');
      this.exitStrategies.push(
        new RiskRewardRatioExitStrategy(this.bot, {
          stopLossThresholdRate:
            this.bot.config.riskRewardRatioExitStrategy_StopLossThresholdRate.value,
        })
      );
    }
    // #################################################################
    // # DurationExitStrategy
    // #################################################################
    if (this.bot.config.durationExitStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering DurationExitStrategy');
      this.exitStrategies.push(
        new DurationExitStrategy(this.bot, {
          maxTimeHoldingSeconds: this.bot.config.durationExitStrategy_MaxTimeHoldingSeconds.value,
        })
      );
    }
    // #################################################################
    // # StopLossExitStrategy
    // #################################################################
    if (this.bot.config.stopLossExitStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering StopLossExitStrategy');
      this.exitStrategies.push(
        new StopLossExitStrategy(this.bot, {
          maxStopLoss: this.bot.config.stopLossExitStrategy_MaxLoss.value,
        })
      );
    }
    // #################################################################
    // # StopLossMAEExitStrategy
    // #################################################################
    if (this.bot.config.stopLossMAEExitStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering StopLossMAEExitStrategy');
      const MAEThreshold = Math.min(
        this.bot.config.stopLossMAEExitStrategy_MAEThreshold.value,
        this.bot.config.stopLossMAEExitStrategy_MaxMAE.value
      );
      this.exitStrategies.push(
        new StopLossMAEExitStrategy(this.bot, {
          MAEThreshold,
        })
      );
    }
    // #################################################################
    // # StopLossSupportResistanceExitStrategy
    // #################################################################
    if (this.bot.config.stopLossSupportResistanceExitStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering StopLossSupportResistanceExitStrategy');
      this.exitStrategies.push(
        new StopLossSupportResistanceExitStrategy(this.bot, {
          pastKlinesToCheck:
            this.bot.config.stopLossSupportResistanceExitStrategy_PastKlinesToCheck.value,
        })
      );
    }
    // #################################################################
    // # StopLossSupportBreakExitStrategy
    // #################################################################
    if (this.bot.config.breakoutStopLossRiskStrategy_Enabled.value) {
      this.logger.info(
        '⚙️ StrategyManager: Registering BreakoutStopLossExitStrategy (linked to BreakoutStopLossRiskStrategy)'
      );
      this.exitStrategies.push(new BreakoutStopLossExitStrategy(this.bot));
    }
    // #################################################################
    // # CrossDoubleEMAExitStrategy
    // #################################################################
    if (this.bot.config.crossDoubleEmaExitStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering DoubleEMAExitStrategy');
      this.exitStrategies.push(
        new CrossDoubleEMAExitStrategy(this.bot, {
          fastPeriod: this.bot.config.crossDoubleEmaExitStrategy_FastPeriod.value,
          slowPeriod: this.bot.config.crossDoubleEmaExitStrategy_SlowPeriod.value,
        })
      );
    }
    // #################################################################
    // # MeanReversionExitStrategy
    // #################################################################
    if (this.bot.config.meanReversionExitStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering MeanReversionExitStrategy');
      this.exitStrategies.push(
        new MeanReversionExitStrategy(this.bot, {
          bollingerPeriod: this.bot.config.meanReversionExitStrategy_BollingerPeriod.value,
          bollingerStdDev: this.bot.config.meanReversionExitStrategy_BollingerStdDev.value,
          rsiPeriod: this.bot.config.meanReversionExitStrategy_RSIPeriod.value,
          rsiOverbought: this.bot.config.meanReversionExitStrategy_RSIOverbought.value,
          rsiOversold: this.bot.config.meanReversionExitStrategy_RSIOversold.value,
        })
      );
    }
    // #################################################################
    // # HullTrendRibbonExitStrategy
    // #################################################################
    if (this.bot.config.hullTrendRibbonExitStrategy_Enabled.value) {
      this.logger.info('⚙️ StrategyManager: Registering HullTrendRibbonExitStrategy');
      this.exitStrategies.push(
        new HullTrendRibbonExitStrategy(this.bot, {
          trendRibbonPeriod: this.bot.config.hullTrendRibbonExitStrategy_TrendRibbonPeriod.value,
          hullPeriod: this.bot.config.hullTrendRibbonExitStrategy_HullPeriod.value,
        })
      );
    }
  }

  public async executeEnterStrategies(klinesBuffer: RollingWindowBuffer<ALXKline>): Promise<void> {
    const newKline = klinesBuffer.getLast();
    if (!newKline || newKline.timeframe !== this.bot.config.timeFrameToTrade) {
      return;
    }

    const botReactStrategy = this.bot.config.eventReactStrategy.value;

    const enterStrategiesToExecute = this.enterStrategies.filter((enterStrategy) => {
      if (
        botReactStrategy === EventReactStrategy.DELTA_KLINE ||
        (botReactStrategy === EventReactStrategy.FULL_KLINE && newKline.type === 'full')
      ) {
        return true;
      } else if (botReactStrategy === EventReactStrategy.AUTO) {
        return (
          enterStrategy.eventReactStrategy === EventReactStrategy.DELTA_KLINE ||
          (enterStrategy.eventReactStrategy === EventReactStrategy.FULL_KLINE &&
            newKline.type === 'full')
        );
      }
      return false;
    });

    const minStrategiesSignaling = Math.min(
      this.enterStrategies.length,
      this.bot.config.numberOfEnterStrategiesToEnter.value
    );
    const enterStrategiesExecutedLongAll: EnterStrategyActionExecuted[] = [];
    const enterStrategiesExecutedShortAll: EnterStrategyActionExecuted[] = [];

    enterStrategiesToExecute.forEach((enterStrategy) => {
      const result = enterStrategy.execute(klinesBuffer);
      if (!result) {
        return;
      }
      if (result.action === EnterStrategyAction.ENTER_LONG) {
        enterStrategiesExecutedLongAll.push(result);
      }
      if (result.action === EnterStrategyAction.ENTER_SHORT) {
        enterStrategiesExecutedShortAll.push(result);
      }
    });

    const regimeBias = this.regimePrefilter?.getBias() ?? 'neutral';
    if (this.regimePrefilter && regimeBias === 'neutral') {
      return;
    }

    const enterStrategiesExecutedLong =
      regimeBias === 'short' ? [] : enterStrategiesExecutedLongAll;
    const enterStrategiesExecutedShort =
      regimeBias === 'long' ? [] : enterStrategiesExecutedShortAll;

    const longStrategiesSignaling = enterStrategiesExecutedLong.length >= minStrategiesSignaling;
    const shortStrategiesSignaling = enterStrategiesExecutedShort.length >= minStrategiesSignaling;

    if (longStrategiesSignaling || shortStrategiesSignaling) {
      try {
        const margin = await this.bot.riskManager.calculateOrderSize();
        if (longStrategiesSignaling) {
          await this.bot.orderManager.openOrderMarket(enterStrategiesExecutedLong, margin);
          return;
        }

        if (shortStrategiesSignaling) {
          await this.bot.orderManager.openOrderMarket(enterStrategiesExecutedShort, margin);
          return;
        }
      } catch (err) {
        this.logger.error(err as Error);
        return;
      }
    }
  }

  public async executeExitStrategies(klinesBuffer: RollingWindowBuffer<ALXKline>): Promise<void> {
    const newKline = klinesBuffer.getLast();
    if (!newKline) {
      return;
    }

    const botReactStrategy = this.bot.config.eventReactStrategy.value;

    const exitStrategiesToExecute = this.exitStrategies.filter((exitStrategy) => {
      if (
        botReactStrategy === EventReactStrategy.DELTA_KLINE ||
        (botReactStrategy === EventReactStrategy.FULL_KLINE && newKline.type === 'full')
      ) {
        return true;
      } else if (botReactStrategy === EventReactStrategy.AUTO) {
        return (
          exitStrategy.eventReactStrategy === EventReactStrategy.DELTA_KLINE ||
          (exitStrategy.eventReactStrategy === EventReactStrategy.FULL_KLINE &&
            newKline.type === 'full')
        );
      }
      return false;
    });

    for (const exitStrategy of exitStrategiesToExecute) {
      const openedPositions = this.bot.positionManager
        .getOpenPositions()
        .filter((position) => position.symbol === newKline.pair);

      for (const position of openedPositions) {
        const result = exitStrategy.execute(klinesBuffer, position);
        if (result && result.action === ExitStrategyAction.EXIT_CLOSE) {
          this.logger.debug(`StrategyManager: Exiting position as per ${result.strategyName}`);
          await this.bot.positionManager.closePosition(position.id, result);
        }
      }
    }
  }
}
