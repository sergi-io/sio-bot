import { formatMoney } from '@/utils/money';
import type { SioBot } from '@/siobot/SioBot';
import { config } from '@/config';
import { logger } from '@/utils/logger';
import { Bot, Context, InlineKeyboard, Keyboard } from 'grammy';
import type { CallbackQueryContext } from 'grammy';
import { ManualEnterStrategy } from '@/strategies/enterStrategies/ManualEnterStrategy';
import ansis from 'ansis';
import { ManualExitStrategy } from '@/strategies/exitStrategies/ManualExitStrategy';
import { RiskStrategyAction, type RiskStrategyActionExecuted } from '@/risk/riskStrategies.types';
import { getCurrentTimestampMs } from '@/utils/date';
import { getAllPositionHistory } from '@/utils/db/positionHistory/getAllPositionHistory';
import { calculateMetrics, groupByDay } from '@/journal/utils/metrics';
import { formatPerformanceMetric } from '@/backtester/performanceMetrics';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { BotRunMode, BotState } from '@/siobot/constants';
import { createHash } from 'crypto';
import { normalizeSymbolString } from '@/utils/symbols';
import type { WebSocketCommandCenterServer } from './WebSocketCommandCenterServer';

const TELEGRAM_MESSAGE_THROTTLE_MS = 1000 / 1; // 2 messages per second throttle
const TELEGRAM_MONITOR_UPDATE_THROTTLE_MS = TELEGRAM_MESSAGE_THROTTLE_MS * 5;
const ME_COMMAND = '!me';
const STATS_COMMAND = '!stats';
const MONITOR_CLOSE_CALLBACK_PREFIX = 'monitor_close:';

export class Telegram {
  static tBot: Bot = new Bot(config.notifications.telegramBotToken);
  static botStarted: boolean = false;
  static sioBot: SioBot | null = null;
  static commandCenter: WebSocketCommandCenterServer | null = null;
  static monitorEnabled: boolean = false;
  static monitorMessageId: number | null = null;
  static monitorChatId: number | null = null;
  static lastMonitorCallTimestamp: number = 0;
  private static monitorUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
  private static monitorUpdateInFlight: boolean = false;
  private static monitorUpdateQueued: boolean = false;
  private static monitorCloseCallbackPositionIds: Map<string, ALXPosition['id']> = new Map();
  static messageQueue: Promise<void> = Promise.resolve();
  static lastMessageSentTimestamp: number = 0;

  static registerSioBot(sioBot: SioBot) {
    Telegram.sioBot = sioBot;
  }

  static registerCommandCenter(commandCenter: WebSocketCommandCenterServer): void {
    Telegram.commandCenter = commandCenter;
  }

  static startService() {
    Telegram.tBot.catch((error) => {
      logger.error(`Telegram bot error while handling update: ${String(error.error)}`);
    });

    // Middleware to check user ID
    Telegram.tBot.use(async (ctx, next) => {
      if (Telegram.isAllowedMessageContext(ctx)) {
        await next();
      }
      return;
    });

    enum MainMenuChoices {
      Positions = '📈 Positions',
      Config = '⚙️ Config',
      Stats = '📊 Stats',
    }

    enum PositionChoices {
      StartMonitor = '📡 Start Position Monitor',
      StopMonitor = '🛑 Stop Position Monitor',
      OpenLong = '🟢 Open Long Position',
      OpenShort = '🔴 Open Short Position',
      Back = '🔙 Back',
    }

    enum ConfigChoices {
      PauseBot = '⏸️ Pause Bot',
      ResumeBot = '▶️ Resume Bot',
      StartCommandCenter = '🌐 Start Command Center',
      StopCommandCenter = '🛑 Stop Command Center',
      Back = '🔙 Back',
    }

    const mainKeyboard = new Keyboard()
      .text(MainMenuChoices.Positions)
      .text(MainMenuChoices.Stats)
      .text(MainMenuChoices.Config)
      .row()
      .persistent();

    const positionKeyboard = new Keyboard()
      .text(PositionChoices.StartMonitor)
      .text(PositionChoices.StopMonitor)
      .row()
      .text(PositionChoices.OpenLong)
      .text(PositionChoices.OpenShort)
      .row()
      .text(PositionChoices.Back)
      .persistent();

    const configKeyboard = new Keyboard()
      .text(ConfigChoices.PauseBot)
      .text(ConfigChoices.ResumeBot)
      .row()
      .text(ConfigChoices.StartCommandCenter)
      .text(ConfigChoices.StopCommandCenter)
      .text(ConfigChoices.Back)
      .persistent();

    Telegram.tBot.command(['start'], async (ctx) => {
      await ctx.reply('Welcome to SioBot!', {
        reply_markup: mainKeyboard,
      });
    });

    /** Command aliases: maps short aliases to their full command string */
    const commandAliases: Record<string, string> = {};

    const handleTextMessage = async (ctx: Context): Promise<void> => {
      const text = commandAliases[ctx.msg?.text ?? ''] ?? ctx.msg?.text;
      if (text === ME_COMMAND) {
        await ctx.reply(Telegram.buildMeReply(ctx), {
          parse_mode: 'HTML',
        });
        return;
      }

      const sioBot = Telegram.requireReady();
      if (!sioBot) {
        return;
      }

      switch (text) {
        // #################################################################
        // # Main Options
        // #################################################################
        case MainMenuChoices.Positions: {
          await ctx.reply('Position Management:', { reply_markup: positionKeyboard });
          break;
        }
        case MainMenuChoices.Stats: {
          await Telegram.sendStatsSummary(ctx);
          break;
        }
        case MainMenuChoices.Config: {
          await ctx.reply('Config Management:', { reply_markup: configKeyboard });
          break;
        }
        // #################################################################
        // # Positions Options
        // #################################################################
        case PositionChoices.StartMonitor: {
          const positions = sioBot.positionManager.getOpenPositions();
          if (positions.length === 0) {
            await ctx.reply('No open positions to monitor.');
            break;
          }
          const closeInlineKeyboard = Telegram.buildMonitorInlineKeyboard(positions);
          const sentMessage = await ctx.reply(Telegram.buildOpenPositionsMonitorText(positions), {
            parse_mode: 'HTML',
            reply_markup: closeInlineKeyboard,
          });
          Telegram.monitorEnabled = true;
          Telegram.monitorMessageId = sentMessage.message_id;
          Telegram.monitorChatId = sentMessage.chat.id;
          Telegram.lastMonitorCallTimestamp = Date.now();
          break;
        }
        case PositionChoices.StopMonitor: {
          if (!Telegram.monitorEnabled) {
            await ctx.reply('Monitor is not running.');
            break;
          }
          Telegram.monitorEnabled = false;
          Telegram.clearPendingMonitorUpdate();
          Telegram.monitorCloseCallbackPositionIds = new Map();
          if (Telegram.monitorMessageId && Telegram.monitorChatId) {
            try {
              await Telegram.enqueueMessage(async () => {
                if (!Telegram.monitorMessageId || !Telegram.monitorChatId) {
                  return;
                }
                await Telegram.tBot.api.editMessageText(
                  Telegram.monitorChatId,
                  Telegram.monitorMessageId,
                  '📡 <b>Position Monitor</b>\n\n🛑 Monitor stopped.',
                  { parse_mode: 'HTML' }
                );
              });
            } catch (error) {
              logger.warn(`Failed to edit monitor message on stop: ${error}`);
            }
          }
          Telegram.monitorMessageId = null;
          Telegram.monitorChatId = null;
          break;
        }
        case PositionChoices.OpenLong: {
          const result = await this.openManualPosition('long');
          if (!result) {
            await ctx.reply('❌ Failed to open LONG position.', {
              parse_mode: 'HTML',
            });
          }
          break;
        }
        case PositionChoices.OpenShort: {
          const result = await this.openManualPosition('short');
          if (!result) {
            await ctx.reply('❌ Failed to open SHORT position.', {
              parse_mode: 'HTML',
            });
          }
          break;
        }

        case STATS_COMMAND: {
          await Telegram.sendStatsSummary(ctx);
          break;
        }
        // #################################################################
        // # Config Options
        // #################################################################
        case ConfigChoices.PauseBot: {
          await sioBot.pause();
          await ctx.reply('⏸️ Bot has been paused.');
          break;
        }
        case ConfigChoices.ResumeBot: {
          await sioBot.resume();
          await ctx.reply('▶️ Bot has been resumed.');
          break;
        }
        case ConfigChoices.StartCommandCenter: {
          const commandCenterUrl = await Telegram.startCommandCenter();
          await ctx.reply(`🌐 Command Center started: ${commandCenterUrl}`);
          break;
        }
        case ConfigChoices.StopCommandCenter: {
          const wasRunning = Telegram.stopCommandCenter();
          await ctx.reply(
            wasRunning ? '🛑 Command Center stopped.' : 'Command Center is not running.'
          );
          break;
        }
        default:
          if (Telegram.isBbwChannelChat(ctx.chat?.id)) {
            return;
          }
          await ctx.reply('🤖', {
            reply_markup: mainKeyboard,
          });
      }
    };

    Telegram.tBot.on('message:text', handleTextMessage);
    Telegram.tBot.on('channel_post:text', handleTextMessage);

    // Monitor: close one selected position (ManualExitStrategy)
    Telegram.tBot.callbackQuery(/^monitor_close:(.+)$/, async (ctx) => {
      const sioBot = Telegram.requireReadyForCallback(ctx);
      if (!sioBot) {
        return;
      }

      const callbackData = ctx.callbackQuery.data;
      const callbackToken = callbackData.slice(MONITOR_CLOSE_CALLBACK_PREFIX.length);
      const positionId = Telegram.monitorCloseCallbackPositionIds.get(callbackToken);
      if (!positionId) {
        await ctx.answerCallbackQuery({
          text: 'This position button is no longer valid.',
          show_alert: false,
        });
        return;
      }

      const position = sioBot.positionManager.getPositionById(positionId);
      if (!position) {
        await ctx.answerCallbackQuery({
          text: 'Position already closed.',
          show_alert: false,
        });
        return;
      }

      const manualExitStrategyExecuted = Telegram.buildManualExitStrategy(sioBot, position);
      if (!manualExitStrategyExecuted) {
        await ctx.answerCallbackQuery({
          text: `No market data available to close ${position.symbol}.`,
          show_alert: false,
        });
        return;
      }

      await ctx.answerCallbackQuery({
        text: `Closing ${position.symbol} position...`,
        show_alert: false,
      });
      await sioBot.positionManager.closePosition(position.id, manualExitStrategyExecuted);
      await Telegram.updatePositionMonitor();
    });

    Telegram.tBot.start();
    logger.info('📨 Telegram bot is up and running...');
    Telegram.botStarted = true;
  }

  static async startCommandCenter(): Promise<string> {
    const sioBot = Telegram.sioBot;
    if (!sioBot) {
      throw new Error('SioBot is not ready yet.');
    }

    if (Telegram.commandCenter === null) {
      const { WebSocketCommandCenterServer } = await import('./WebSocketCommandCenterServer');
      Telegram.commandCenter = new WebSocketCommandCenterServer({ bot: sioBot });
    }

    await Telegram.commandCenter.start();
    return Telegram.commandCenter.getUrl();
  }

  static stopCommandCenter(): boolean {
    if (!Telegram.commandCenter?.isRunning()) {
      return false;
    }

    Telegram.commandCenter.stop();
    return true;
  }

  private static buildMonitorInlineKeyboard(positions: ALXPosition[]): InlineKeyboard {
    const inlineKeyboard = new InlineKeyboard();
    Telegram.monitorCloseCallbackPositionIds = new Map();

    for (const position of positions) {
      const token = Telegram.getMonitorCloseCallbackToken(position);
      Telegram.monitorCloseCallbackPositionIds.set(token, position.id);
      inlineKeyboard
        .text(
          Telegram.formatMonitorCloseButtonLabel(position),
          `${MONITOR_CLOSE_CALLBACK_PREFIX}${token}`
        )
        .row();
    }

    return inlineKeyboard;
  }

  private static buildOpenPositionsMonitorText(positions: ALXPosition[]): string {
    const sioBot = Telegram.sioBot;
    let monitorText = '📡 <b>Position Monitor (Live)</b>\n\n';

    if (!sioBot) {
      return monitorText;
    }

    for (const position of positions) {
      monitorText += `${ansis.strip(sioBot.positionManager.getPositionLogMsg(position))}\n`;
    }

    return monitorText;
  }

  private static buildManualExitStrategy(
    sioBot: SioBot,
    position: ALXPosition
  ): ReturnType<ManualExitStrategy['execute']> {
    const klineBuffer =
      sioBot.exchange.getKlinesBuffer(position.symbol, sioBot.config.timeFrameToTrade) ??
      sioBot.exchange.getKlinesBuffer(
        sioBot.config.assetSymbol,
        sioBot.config.timeFrameToTrade
      );

    if (!klineBuffer) {
      return false;
    }

    return new ManualExitStrategy(sioBot).execute(klineBuffer);
  }

  private static getMonitorCloseCallbackToken(position: ALXPosition): string {
    return createHash('sha1').update(position.id).digest('base64url').slice(0, 16);
  }

  private static formatMonitorCloseButtonLabel(position: ALXPosition): string {
    const pnlEmoji = Telegram.getPnlEmoji(position.realizedPnl);
    const symbol = Telegram.formatPositionSymbol(position.symbol);
    const pnl = formatMoney(position.realizedPnl, { colorize: false, withIcon: false });

    return `❌ Close ${pnlEmoji} ${symbol} (${pnl})`;
  }

  private static formatPositionSymbol(symbol: string): string {
    const normalizedSymbol = normalizeSymbolString(symbol) ?? symbol;
    const quoteAssets = ['USDT', 'USDC', 'USD', 'BTC', 'ETH'];
    const quoteAsset = quoteAssets.find((candidate) => normalizedSymbol.endsWith(candidate));

    if (!quoteAsset) {
      return normalizedSymbol;
    }

    return normalizedSymbol.slice(0, -quoteAsset.length) || normalizedSymbol;
  }

  private static isAuthorizedMessageContext(ctx: Context): boolean {
    const fromUserId = ctx.from?.id;
    if (
      fromUserId !== undefined &&
      config.notifications.telegramAllowedUserIds.includes(fromUserId)
    ) {
      return true;
    }
    return false;
  }

  private static isMeCommandContext(ctx: Context): boolean {
    return (ctx.msg?.text ?? '').trim() === ME_COMMAND;
  }

  private static isStatsCommandContext(ctx: Context): boolean {
    return (ctx.msg?.text ?? '').trim() === STATS_COMMAND;
  }

  private static isPublicBbwCommandContext(ctx: Context): boolean {
    return (
      Telegram.isBbwChannelChat(ctx.chat?.id) &&
      (Telegram.isMeCommandContext(ctx) || Telegram.isStatsCommandContext(ctx))
    );
  }

  private static isAllowedMessageContext(ctx: Context): boolean {
    if (Telegram.isBbwChannelChat(ctx.chat?.id)) {
      return Telegram.isPublicBbwCommandContext(ctx);
    }

    if (ctx.chat?.type === 'private') {
      return Telegram.isAuthorizedMessageContext(ctx) || Telegram.isPublicBbwCommandContext(ctx);
    }

    return Telegram.isAuthorizedMessageContext(ctx);
  }

  private static isBbwChannelChat(chatId: number | undefined): boolean {
    return (
      chatId !== undefined &&
      config.notifications.telegramBbwChannelId !== 0 &&
      chatId === config.notifications.telegramBbwChannelId
    );
  }

  private static buildMeReply(ctx: Context): string {
    const lines = ['👤 <b>Telegram ID</b>'];

    if (ctx.from?.id !== undefined) {
      lines.push(`User: <code>${ctx.from.id}</code>`);
    } else {
      lines.push('User: <code>unavailable</code>');
    }

    if (ctx.chat?.type === 'channel') {
      lines.push(`Channel: <code>${ctx.chat.id}</code>`);
    }

    return lines.join('\n');
  }

  static async updatePositionMonitor(): Promise<void> {
    Telegram.schedulePositionMonitorUpdate();
  }

  private static schedulePositionMonitorUpdate(): void {
    const sioBot = Telegram.sioBot;
    if (
      !sioBot ||
      !Telegram.monitorEnabled ||
      !Telegram.monitorMessageId ||
      !Telegram.monitorChatId
    ) {
      return;
    }

    if (Telegram.monitorUpdateInFlight) {
      Telegram.monitorUpdateQueued = true;
      return;
    }

    if (Telegram.monitorUpdateTimeout) {
      return;
    }

    const now = Date.now();
    const elapsedMs = now - Telegram.lastMonitorCallTimestamp;
    const waitMs = Math.max(0, TELEGRAM_MONITOR_UPDATE_THROTTLE_MS - elapsedMs);

    Telegram.monitorUpdateTimeout = setTimeout(() => {
      Telegram.monitorUpdateTimeout = null;
      Telegram.flushPositionMonitorUpdate().catch((error) => {
        logger.warn(`Failed to flush position monitor update: ${String(error)}`);
      });
    }, waitMs);
  }

  private static async flushPositionMonitorUpdate(): Promise<void> {
    if (Telegram.monitorUpdateInFlight) {
      Telegram.monitorUpdateQueued = true;
      return;
    }

    Telegram.monitorUpdateInFlight = true;
    Telegram.monitorUpdateQueued = false;

    try {
      await Telegram.enqueueMessage(async () => {
        const sioBot = Telegram.sioBot;
        if (
          !sioBot ||
          !Telegram.monitorEnabled ||
          !Telegram.monitorMessageId ||
          !Telegram.monitorChatId
        ) {
          return;
        }

        const positions = sioBot.positionManager.getOpenPositions();

        let monitorText: string;
        let replyMarkup: InlineKeyboard | undefined;

        if (positions.length === 0) {
          monitorText =
            '📡 <b>Position Monitor</b>\n\n✅ All positions have been closed.\n\n🛑 Monitor stopped.';
          Telegram.monitorEnabled = false;
          Telegram.monitorCloseCallbackPositionIds = new Map();
          replyMarkup = undefined;
        } else {
          monitorText = Telegram.buildOpenPositionsMonitorText(positions);
          replyMarkup = Telegram.buildMonitorInlineKeyboard(positions);
        }

        Telegram.lastMonitorCallTimestamp = Date.now();

        try {
          await Telegram.tBot.api.editMessageText(
            Telegram.monitorChatId,
            Telegram.monitorMessageId,
            monitorText,
            {
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            }
          );
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          if (errMsg.includes('message is not modified')) {
            return;
          }
          logger.warn(`Failed to update position monitor message: ${errMsg}`);
          // If message was deleted or not found, disable monitor
          if (
            errMsg.includes('message to edit not found') ||
            errMsg.includes('MESSAGE_ID_INVALID')
          ) {
            Telegram.disablePositionMonitor();
          }
        }

        if (!Telegram.monitorEnabled) {
          Telegram.monitorMessageId = null;
          Telegram.monitorChatId = null;
        }
      });
    } finally {
      Telegram.monitorUpdateInFlight = false;
      if (Telegram.monitorUpdateQueued && Telegram.monitorEnabled) {
        Telegram.schedulePositionMonitorUpdate();
      }
    }
  }

  private static clearPendingMonitorUpdate(): void {
    if (Telegram.monitorUpdateTimeout) {
      clearTimeout(Telegram.monitorUpdateTimeout);
      Telegram.monitorUpdateTimeout = null;
    }
    Telegram.monitorUpdateQueued = false;
  }

  private static disablePositionMonitor(): void {
    Telegram.clearPendingMonitorUpdate();
    Telegram.monitorEnabled = false;
    Telegram.monitorMessageId = null;
    Telegram.monitorChatId = null;
    Telegram.monitorCloseCallbackPositionIds = new Map();
  }

  private static async openManualPosition(enterSide: 'long' | 'short'): Promise<boolean> {
    const sioBot = Telegram.sioBot;
    if (!sioBot) {
      logger.warn('Ignoring manual Telegram position request because SioBot is not ready yet.');
      return false;
    }

    const klineBuffer = sioBot.exchange.getKlinesBuffer(
      sioBot.config.assetSymbol,
      sioBot.config.timeFrameToTrade
    )!;
    const manualEnterStrategyExecuted = new ManualEnterStrategy(sioBot, {
      enterSide,
    }).execute(klineBuffer);

    if (!klineBuffer || !manualEnterStrategyExecuted) {
      return false;
    }

    const margin = await sioBot.riskManager.calculateOrderSize();
    if (
      sioBot.config.dcaRiskStrategy_Enabled.value &&
      sioBot.positionManager.getOpenPositions().length > 0
    ) {
      const manualRiskStrategy: RiskStrategyActionExecuted = {
        strategyName: 'DCA_Level_ManualEnter',
        params: {},
        action: RiskStrategyAction.DCA,
        executionTimestamp: getCurrentTimestampMs(),
        kline: klineBuffer.getLast()!,
      };
      await sioBot.orderManager.openOrderMarketForRiskManagement(
        [manualRiskStrategy],
        sioBot.positionManager.getOpenPositions()[0]!,
        margin
      );
    } else {
      await sioBot.orderManager.openOrderMarket([manualEnterStrategyExecuted], margin, {
        isManual: true,
      });
    }
    return true;
  }

  private static async sendStatsSummary(ctx: Context): Promise<void> {
    const sioBot = Telegram.requireReady();
    if (!sioBot) {
      return;
    }

    await sioBot.positionManager.syncPositionsFromExchange();
    const openPositions = sioBot.positionManager.getOpenPositions();

    if (openPositions.length > 0) {
      await sioBot.positionManager.recalculatePositions();
    }

    const fiveDayJournalReply = await Telegram.buildJournalSummary(5);

    let reply = '📊 <b>Stats</b>\n';
    reply += `${Telegram.formatRunModeLabel(sioBot.mode)}\n`;
    reply += `${fiveDayJournalReply}\n\n`;
    reply += `🤖 <b>Bot Status:</b> ${Telegram.formatBotStateLabel(sioBot.getState())}\n`;

    const balance = await sioBot.exchange.getBalance();
    reply += `🏦 <b>Balance:</b> ${formatMoney(balance, { colorize: false })}\n\n`;
    if (openPositions.length === 0) {
      reply += '📭 <b>Open Position:</b> none';
      await ctx.reply(reply.trimEnd(), { parse_mode: 'HTML' });
      return;
    }

    reply += `<b>Open Position${openPositions.length === 1 ? '' : 's'}:</b>\n`;
    reply += openPositions
      .map((position) => Telegram.formatOpenPositionSummary(position))
      .join('\n\n');

    await ctx.reply(reply.trimEnd(), { parse_mode: 'HTML' });
  }

  private static async buildJournalSummary(days: number): Promise<string> {
    const now = new Date();
    const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - (days - 1));

    const positions = await getAllPositionHistory();
    const periodPositions = positions.filter((position) => {
      const closeDate = new Date(position.closeTimestamp);
      const closeDay = Date.UTC(
        closeDate.getUTCFullYear(),
        closeDate.getUTCMonth(),
        closeDate.getUTCDate()
      );
      return closeDay >= startDate.getTime() && closeDay <= endDate.getTime();
    });

    const metrics = calculateMetrics(periodPositions);
    const dailyStats = groupByDay(periodPositions);

    let reply =
      `📓 <b>Last ${days} Days PnL</b> ` +
      `(${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})\n`;
    reply +=
      `<b>PF:</b> ${formatPerformanceMetric(metrics.profitFactor)} | ` +
      `<b>WR:</b> ${metrics.winRate.toFixed(2)}% | ` +
      `<b>Trades:</b> ${metrics.totalTrades} | ` +
      `<b>PNL:</b> ${formatMoney(metrics.netPnl, { colorize: false, withIcon: false })}\n`;

    for (let offset = 0; offset < days; offset++) {
      const date = new Date(startDate);
      date.setUTCDate(startDate.getUTCDate() + offset);
      const dateStr = date.toISOString().split('T')[0]!;
      const dayStats = dailyStats[dateStr];
      const pnl = dayStats?.totalPnl ?? 0;
      const tradeCount = dayStats?.tradeCount ?? 0;
      reply +=
        `${Telegram.getPnlEmoji(pnl)} ${dateStr}: ` +
        `${tradeCount} trade${tradeCount === 1 ? '' : 's'} | ` +
        `PNL ${formatMoney(pnl, { colorize: false, withIcon: false })}\n`;
    }

    return reply.trimEnd();
  }

  private static formatRunModeLabel(mode: BotRunMode): string {
    return mode === BotRunMode.PAPER_TRADE
      ? '🧪 <b>Mode: PAPER TRADE</b>'
      : '💰 <b>Mode: REAL TRADE</b>';
  }

  private static formatOpenPositionSummary(position: ALXPosition): string {
    const pnlEmoji = Telegram.getPnlEmoji(position.realizedPnl);
    const sideLabel = position.side === ALXPositionSide.LONG ? 'LONG' : 'SHORT';
    const totalPositionSize = position.quantity * position.entryPrice;

    return (
      `${pnlEmoji} <b>${position.symbol}</b> | ` +
      `${sideLabel} | ` +
      `${position.leverage}x | ` +
      `PnL: ${formatMoney(position.realizedPnl, { colorize: false, withIcon: false })} | ` +
      `Size: ${formatMoney(totalPositionSize, { colorize: false, withIcon: false })}`
    );
  }

  private static formatBotStateLabel(state: BotState): string {
    switch (state) {
      case BotState.PAUSED:
        return '⏸️ Paused';
      case BotState.LOOKING_FOR_TRADES:
        return '🔎 Looking for trades';
      case BotState.INITIALIZING:
        return '🛠️ Initializing';
      case BotState.COOLING_DOWN:
        return '⏳ Cooling down';
      case BotState.WARMING_UP:
        return '🔥 Warming up';
      case BotState.OPTIMIZING:
        return '🧠 Optimizing';
      default:
        return state;
    }
  }

  private static getPnlEmoji(pnl: number): string {
    if (pnl > 0) {
      return '🟢';
    }
    if (pnl < 0) {
      return '🔴';
    }
    return '⚪';
  }

  private static requireReady(): SioBot | null {
    if (Telegram.sioBot) {
      return Telegram.sioBot;
    }

    logger.warn('Ignoring Telegram message because SioBot is not ready yet.');
    return null;
  }

  private static requireReadyForCallback(ctx: CallbackQueryContext<Context>): SioBot | null {
    if (Telegram.sioBot) {
      return Telegram.sioBot;
    }

    logger.warn('Ignoring Telegram callback because SioBot is not ready yet.');
    void ctx.answerCallbackQuery({
      text: 'Bot is still starting. Try again in a few seconds.',
      show_alert: false,
    });
    return null;
  }

  static sendMessage(message: string): void {
    if (!config.notifications.enabled || !Telegram.botStarted) {
      return;
    }

    const finalMessage = `[${config.general.projectName}] ${ansis.strip(message)}`;
    const allowedUserIds = config.notifications.telegramAllowedUserIds;
    if (allowedUserIds.length === 0) {
      logger.warn('Skipping Telegram message because no allowed user IDs are configured.');
      return;
    }

    for (const userId of allowedUserIds) {
      Telegram.enqueueMessage(async () => {
        try {
          await Telegram.tBot.api.sendMessage(userId, finalMessage);
        } catch (error) {
          logger.error(`Error sending Telegram message to ${userId}: ${String(error)}`);
        }
      });
    }
  }

  private static enqueueMessage(sendFn: () => Promise<void>): Promise<void> {
    Telegram.messageQueue = Telegram.messageQueue
      .then(async () => {
        const elapsedMs = Date.now() - Telegram.lastMessageSentTimestamp;
        const waitMs = TELEGRAM_MESSAGE_THROTTLE_MS - elapsedMs;
        if (waitMs > 0) {
          await Telegram.sleep(waitMs);
        }
        await sendFn();
        Telegram.lastMessageSentTimestamp = Date.now();
      })
      .catch((error) => {
        logger.error('Error in Telegram message queue:', error);
      });

    return Telegram.messageQueue;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
