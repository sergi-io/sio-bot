import type { SioBot } from '@/siobot/SioBot';
import { Telegram } from '@/comms/Telegram';
import { type ALXOrder, ALXOrderLimitType, ALXOrderSide, ALXOrderType } from '@/domain/ALXOrder';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { type RiskStrategyActionExecuted } from '@/risk/riskStrategies.types';
import {
  EnterStrategyAction,
  type EnterStrategyActionExecuted,
} from '@/strategies/strategies.types';
import { getCurrentTimestampMs } from '@/utils/date';
import { logger } from '@/utils/logger';
import { capOrderSizeUSDT } from '@/risk/orderSize';
import { nanoid } from 'nanoid';

type OpenOrderMarketOptions = {
  isManual?: boolean;
  orderType?: ALXOrderType;
  limitType?: ALXOrderLimitType;
  limitOffsetRate?: number;
  takeProfitRiskRewardRatio?: number;
};

export class OrderManager {
  private bot: SioBot;

  constructor(bot: SioBot) {
    this.bot = bot;
  }

  public async openOrderMarket(
    enterStrategiesExecuted: EnterStrategyActionExecuted[],
    margin: number,
    options: OpenOrderMarketOptions = {}
  ) {
    if (!this.bot.riskManager.canTrade()) {
      return;
    }

    if (enterStrategiesExecuted.length === 0) {
      throw new Error('No enter strategies executed provided for opening market order');
    }

    const cappedMargin = capOrderSizeUSDT(margin, this.bot.config);
    if (cappedMargin < margin) {
      logger.warn(
        `OrderManager: Capping market order margin from ${margin.toFixed(2)} to ${cappedMargin.toFixed(2)} USDT.`
      );
    }

    const symbol = enterStrategiesExecuted[0]!.kline.pair;
    const klineTimestamp = enterStrategiesExecuted[0]!.kline?.timestamp;
    const openedTimestamp = this.bot.isBackTesting() ? klineTimestamp : getCurrentTimestampMs();

    if (!options.isManual) {
      const cooldownRemainingMs = this.bot.positionManager.getAutoEnterCooldownRemainingMs(
        symbol,
        openedTimestamp
      );
      if (cooldownRemainingMs > 0) {
        logger.debug(
          `OrderManager: Auto open blocked by cooldown for ${symbol}. Remaining ${Math.ceil(cooldownRemainingMs / 1000)}s.`
        );
        return;
      }
    }

    const currentPrice = this.bot.exchange.getCurrentPrice(
      symbol,
      this.bot.config.timeFrameToTrade
    );
    if (currentPrice === null) {
      logger.warn(`OrderManager(openOrderMarket): Cannot fetch current price for symbol ${symbol}`);
      return;
    }

    const maxPositionRunning = this.bot.riskManager.getMaxPositionsRunning();
    if (this.bot.positionManager.getNumOpenedPositions() >= maxPositionRunning) {
      logger.debug(
        `OrderManager: Max positions running reached (${maxPositionRunning}). Cannot open new position.`
      );
      return;
    }

    const icon =
      enterStrategiesExecuted[0]!.action === EnterStrategyAction.ENTER_LONG ? '🔺' : '🔻';
    const direction =
      enterStrategiesExecuted[0]!.action === EnterStrategyAction.ENTER_LONG ? 'LONG' : 'SHORT';
    const message = `${icon} Open ${direction} (${symbol}). Margin: ${cappedMargin.toFixed(2)} - strategies: ${enterStrategiesExecuted
      .map((s) => s.strategyName)
      .join(', ')}`;
    if (!this.bot.isBackTesting()) {
      logger.info(message);
      Telegram.sendMessage(message);
    }

    const leverage = this.bot.riskManager.calculateLeverage() ?? 1;
    const orderType = options.orderType ?? ALXOrderType.MARKET;
    const side = OrderManager.enterStrategyActionToOrderSide(enterStrategiesExecuted[0]!.action);
    const orderPrice = this.calculateOrderPrice(currentPrice, side, orderType, options);
    const leveragedMargin = cappedMargin * leverage;

    const order: ALXOrder = {
      id: nanoid(),
      symbol,
      margin: cappedMargin,
      quantity: leveragedMargin / orderPrice,
      price: orderPrice,
      leverage,
      openedByStrategies: enterStrategiesExecuted,
      side,
      type: orderType,
      limitType: orderType === ALXOrderType.LIMIT ? options.limitType : undefined,
      openedTimestamp,
    };
    order.stopLossPrice = this.calculateConfiguredStopLossPrice(order);
    order.takeProfitPrice = this.calculateConfiguredTakeProfitPrice(
      order,
      options.takeProfitRiskRewardRatio
    );

    await this.bot.exchange.setLeverageBySymbol(order.symbol, leverage);
    await this.bot.exchange.openOrder(order, this.bot.isBackTesting());
    this.bot.positionManager.registerPendingOpenOrder(order);

    // @TODO: Should this go here?
    await this.bot.positionManager.syncPositionsFromExchange();
  }

  public async openOrderMarketForRiskManagement(
    riskStrategiesExecuted: RiskStrategyActionExecuted[],
    position: ALXPosition,
    margin: number
  ) {
    if (riskStrategiesExecuted.length === 0) {
      throw new Error('No risk strategies executed provided for opening market order');
    }

    const cappedMargin = capOrderSizeUSDT(margin, this.bot.config);
    if (cappedMargin < margin) {
      logger.warn(
        `OrderManager: Capping risk-management order margin from ${margin.toFixed(2)} to ${cappedMargin.toFixed(2)} USDT.`
      );
    }

    const currentPrice = this.bot.exchange.getCurrentPrice(
      position.symbol,
      this.bot.config.timeFrameToTrade
    );
    if (currentPrice === null) {
      logger.warn(
        `OrderManager(openOrderMarketForRiskManagement): Cannot fetch current price for symbol ${position.symbol}`
      );
      return;
    }

    const klineTimestamp = riskStrategiesExecuted[0]!.kline?.timestamp;
    const icon = position.side === ALXPositionSide.LONG ? '🔺' : '🔻';
    const direction = position.side === ALXPositionSide.LONG ? 'LONG' : 'SHORT';
    const message = `${icon} Open ${direction} (${position.symbol}). Margin: ${cappedMargin.toFixed(2)} - RiskStrategies: ${riskStrategiesExecuted
      .map((s) => s.strategyName)
      .join(', ')}`;
    if (!this.bot.isBackTesting()) {
      logger.info(message);
      Telegram.sendMessage(message);
    }

    const leverage = position.leverage ?? 1;
    const leveragedMargin = cappedMargin * leverage;

    const order: ALXOrder = {
      id: nanoid(),
      symbol: position.symbol,
      margin: cappedMargin,
      quantity: leveragedMargin / currentPrice,
      price: currentPrice,
      leverage,
      riskStrategiesExecuted,
      side: position.side === ALXPositionSide.LONG ? ALXOrderSide.BUY : ALXOrderSide.SELL,
      type: ALXOrderType.MARKET,
      openedTimestamp: this.bot.isBackTesting() ? klineTimestamp : getCurrentTimestampMs(),
    };

    await this.bot.exchange.openOrder(order, this.bot.isBackTesting());
    this.bot.positionManager.registerPendingOpenOrder(order);

    // @TODO: Should this go here?
    await this.bot.positionManager.syncPositionsFromExchange();
  }

  public static enterStrategyActionToOrderSide(action: EnterStrategyAction): ALXOrderSide {
    return action === EnterStrategyAction.ENTER_LONG ? ALXOrderSide.BUY : ALXOrderSide.SELL;
  }

  private calculateConfiguredStopLossPrice(order: ALXOrder): number | undefined {
    if (!this.bot.config.stopLossExitStrategy_Enabled.value) {
      return undefined;
    }

    const maxLoss = this.bot.config.stopLossExitStrategy_MaxLoss.value;
    if (maxLoss >= 0) {
      logger.warn(
        `OrderManager: stopLossExitStrategy_MaxLoss must be negative to create an exchange stop loss. Current value: ${maxLoss}`
      );
      return undefined;
    }

    if (order.quantity <= 0 || order.price <= 0) {
      logger.warn(
        `OrderManager: Cannot calculate stop loss for ${order.symbol}; invalid quantity=${order.quantity} price=${order.price}`
      );
      return undefined;
    }

    const fees = this.bot.exchange.getFeeRateBySymbol(order.symbol);
    const takerRate = fees.takerRate / 100;
    const entryPrice = order.price;
    const maxLossPerUnit = maxLoss / order.quantity;
    const stopLossPrice =
      order.side === ALXOrderSide.BUY
        ? (maxLossPerUnit + entryPrice * (1 + takerRate)) / (1 - takerRate)
        : (entryPrice * (1 - takerRate) - maxLossPerUnit) / (1 + takerRate);

    if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0) {
      logger.warn(
        `OrderManager: Calculated invalid stop loss price for ${order.symbol}: ${stopLossPrice}`
      );
      return undefined;
    }

    logger.info(
      `OrderManager: Exchange stop loss for ${order.symbol} set at ${stopLossPrice.toFixed(8)} for max net loss ${maxLoss.toFixed(2)} USDT.`
    );
    return stopLossPrice;
  }

  private calculateOrderPrice(
    currentPrice: number,
    side: ALXOrderSide,
    orderType: ALXOrderType,
    options: OpenOrderMarketOptions
  ): number {
    if (orderType === ALXOrderType.MARKET) {
      return currentPrice;
    }

    const offsetRate = Math.max(options.limitOffsetRate ?? 0, 0);
    return side === ALXOrderSide.BUY
      ? currentPrice * (1 - offsetRate)
      : currentPrice * (1 + offsetRate);
  }

  private calculateConfiguredTakeProfitPrice(
    order: ALXOrder,
    riskRewardRatio: number | undefined
  ): number | undefined {
    if (!riskRewardRatio || riskRewardRatio <= 0 || order.stopLossPrice === undefined) {
      return undefined;
    }

    const stopLossDistance = Math.abs(order.price - order.stopLossPrice);
    if (!Number.isFinite(stopLossDistance) || stopLossDistance <= 0) {
      return undefined;
    }

    const takeProfitPrice =
      order.side === ALXOrderSide.BUY
        ? order.price + stopLossDistance * riskRewardRatio
        : order.price - stopLossDistance * riskRewardRatio;

    if (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0) {
      logger.warn(
        `OrderManager: Calculated invalid take profit price for ${order.symbol}: ${takeProfitPrice}`
      );
      return undefined;
    }

    logger.info(
      `OrderManager: Exchange take profit for ${order.symbol} set at ${takeProfitPrice.toFixed(8)} using ${riskRewardRatio.toFixed(2)}R.`
    );
    return takeProfitPrice;
  }
}
