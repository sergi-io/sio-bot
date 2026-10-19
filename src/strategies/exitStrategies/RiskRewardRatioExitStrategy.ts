import {
  ExitStrategyAction,
  type ExitStrategyActionExecuted,
  type ExitStrategy,
} from '../strategies.types';
import type { SioBot } from '@/siobot/SioBot';
import type { ALXKline } from '@/domain/ALXKline';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { logger } from '@/utils/logger';
import { EventReactStrategy } from '@/siobot/BotConfig';
import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

interface RiskRewardRatioExitStrategyParams {
  stopLossThresholdRate: number;
}

export class RiskRewardRatioExitStrategy implements ExitStrategy {
  public name: string = 'RiskRewardRatioStrategy';
  public eventReactStrategy: EventReactStrategy = EventReactStrategy.FULL_KLINE;
  public bot: SioBot;
  private params: RiskRewardRatioExitStrategyParams;

  constructor(bot: SioBot, params: RiskRewardRatioExitStrategyParams) {
    this.bot = bot;
    this.params = params;
  }

  public execute(
    klinesBuffer: RollingWindowBuffer<ALXKline>,
    position: ALXPosition
  ): ExitStrategyActionExecuted | false {
    const currentKline = klinesBuffer.getLast();

    if (!currentKline) {
      logger.warn(
        `RiskRewardRatioExitStrategy: Cannot fetch current price for symbol ${position.symbol}`
      );
      return false;
    }

    // We take the lower riskRewardRatio from the strategies that opened the position to be more conservative
    const riskRewardRatio =
      position.openedByStrategies?.reduce((minRatio, strategy) => {
        return Math.min(minRatio, strategy.params.riskRewardRatio);
      }, Infinity) || 0;

    if (riskRewardRatio <= 0) {
      return false;
    }

    const isLong = position.side === ALXPositionSide.LONG;
    const isShort = position.side === ALXPositionSide.SHORT;

    const { stopLossPrice, rewardPrice, stopLossPnl, rewardPnl } = this.getExits(
      position,
      this.params.stopLossThresholdRate,
      riskRewardRatio
    );

    const stopLossHit =
      (isLong && currentKline.low <= stopLossPrice) ||
      (isShort && currentKline.high >= stopLossPrice);
    const rewardHit =
      (isLong && currentKline.high >= rewardPrice) || (isShort && currentKline.low <= rewardPrice);

    const execute = stopLossHit || rewardHit;

    if (!execute) {
      return false;
    }

    return {
      strategyName: this.name,
      params: {
        ...this.params,
        stopLossPrice,
        rewardPrice,
        stopLossPnl,
        rewardPnl,
        riskRewardRatio: riskRewardRatio,
      },
      action: ExitStrategyAction.EXIT_CLOSE,
      kline: currentKline,
    };
  }

  public getExits(
    position: ALXPosition,
    stopLossThresholdRate: number,
    riskRewardRatio: number
  ): {
    stopLossPrice: number;
    rewardPrice: number;
    stopLossPnl: number;
    rewardPnl: number;
  } {
    const risk = Math.abs(position.entryPrice * stopLossThresholdRate);
    const reward = risk * riskRewardRatio;

    const isLong = position.side === ALXPositionSide.LONG;

    const stopLossPrice = isLong ? position.entryPrice - risk : position.entryPrice + risk;
    const rewardPrice = isLong ? position.entryPrice + reward : position.entryPrice - reward;
    const stopLossPnl = isLong
      ? ((stopLossPrice - position.entryPrice) / position.entryPrice) *
        position.leverage *
        position.margin
      : ((position.entryPrice - stopLossPrice) / position.entryPrice) *
        position.leverage *
        position.margin;
    const rewardPnl = isLong
      ? ((rewardPrice - position.entryPrice) / position.entryPrice) *
        position.leverage *
        position.margin
      : ((position.entryPrice - rewardPrice) / position.entryPrice) *
        position.leverage *
        position.margin;

    return {
      stopLossPrice,
      rewardPrice,
      stopLossPnl,
      rewardPnl,
    };
  }
}
