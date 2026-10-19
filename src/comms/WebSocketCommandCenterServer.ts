import path from 'path';
import { existsSync } from 'fs';
import type { SioBot } from '@/siobot/SioBot';
import type { ALXKline } from '@/domain/ALXKline';
import type { ALXPosition } from '@/domain/ALXPosition';
import { ExitStrategyAction } from '@/strategies/strategies.types';
import { BotState } from '@/siobot/constants';
import { getCurrentTimestampMs } from '@/utils/date';
import { logger } from '@/utils/logger';
import { config } from '@/config';
import { getAllPositionHistory } from '@/utils/db/positionHistory/getAllPositionHistory';
import type { JournalPosition } from '@/journal/types';
import {
  commandCenterAppJs,
  commandCenterIndexHtml,
  commandCenterStylesCss,
} from '@/comms/commandCenterFrontend';
import { CommandCenterRestApi } from '@/comms/CommandCenterRestApi';

type CommandCenterPositionHistoryEntry = {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  closePrice: number;
  quantity: number;
  margin: number;
  leverage: number;
  openTimestamp: number;
  closeTimestamp: number;
  realizedPnl: number;
  mae: number;
  minPnl: number;
  maxPnl: number;
};

type CommandCenterSnapshotPayload = {
  updatedAt: number;
  bot: {
    state: string;
    mode: string;
    assetSymbol: string;
    timeframe: string;
    marketScannerFeedEnabled: boolean;
    marketScannerAutotradingEnabled: boolean;
    assetAutoReentryCooldownSeconds: number;
  };
  balance: {
    total: number;
    available: number;
    locked: number;
  };
  positions: ALXPosition[];
  positionHistory: CommandCenterPositionHistoryEntry[];
  marketScannerSnapshot: ReturnType<SioBot['getMarketScannerSnapshot']>;
};

type CommandCenterClientData = {
  id: string;
};

type CommandCenterClientMessage =
  | {
      type: 'closePosition';
      requestId?: string;
      positionId: string;
    }
  | {
      type: 'syncPositions';
      requestId?: string;
    }
  | {
      type: 'setMarketScannerFeed';
      requestId?: string;
      enabled: boolean;
    }
  | {
      type: 'setMarketScannerMode';
      requestId?: string;
      enabled: boolean;
    }
  | {
      type: 'openManualScannerPosition';
      requestId?: string;
      symbol: string;
      side: 'long' | 'short';
    };

type CommandCenterServerMessage =
  | {
      type: 'snapshot';
      payload: CommandCenterSnapshotPayload;
    }
  | {
      type: 'marketScannerSnapshot';
      payload: ReturnType<SioBot['getMarketScannerSnapshot']>;
    }
  | {
      type: 'commandResult';
      requestId?: string;
      ok: boolean;
      positionId?: string;
      error?: string;
    };

export class WebSocketCommandCenterServer {
  private static readonly SNAPSHOT_BROADCAST_INTERVAL_MS = 1_000;
  private static readonly MARKET_SCANNER_REALTIME_POLL_INTERVAL_MS = 500;
  private static readonly POSITION_HISTORY_LIMIT = 100;
  private readonly bot: SioBot;
  private readonly hostname: string;
  private readonly port: number;
  private readonly frontendDir = path.resolve(import.meta.dir, '../../frontend');
  private readonly restApi = new CommandCenterRestApi();
  private readonly clients = new Set<Bun.ServerWebSocket<CommandCenterClientData>>();
  private server: Bun.Server<CommandCenterClientData> | null = null;
  private appJs: string | null = null;
  private snapshotBroadcastInterval: ReturnType<typeof setInterval> | null = null;
  private marketScannerRealtimeInterval: ReturnType<typeof setInterval> | null = null;
  private lastMarketScannerSnapshotTimestamp: number | null = null;
  private marketScannerFeedEnabled = false;
  private positionHistorySnapshot: CommandCenterPositionHistoryEntry[] = [];
  private openPositionIds = new Set<ALXPosition['id']>();
  private unsubscribeOpenPositionsChange: (() => void) | null = null;

  constructor({
    bot,
    hostname = '0.0.0.0',
    port = config.frontend.port,
  }: {
    bot: SioBot;
    hostname?: string;
    port?: number;
  }) {
    this.bot = bot;
    this.hostname = hostname;
    this.port = port;
  }

  public async start(): Promise<void> {
    if (this.server !== null) {
      return;
    }

    await this.refreshPositionHistorySnapshot();
    this.openPositionIds = this.getOpenPositionIds();

    this.appJs = this.shouldUseEmbeddedFrontend()
      ? commandCenterAppJs
      : await this.buildFrontendBundle();

    if (this.marketScannerFeedEnabled) {
      try {
        await this.bot.ensureMarketScannerClientConnected();
      } catch (err) {
        logger.warn(
          `Command Center market scanner feed could not be connected: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    this.server = Bun.serve<CommandCenterClientData>({
      hostname: this.hostname,
      port: this.port,
      fetch: (request, server) => this.handleRequest(request, server),
      websocket: {
        open: (ws) => {
          this.clients.add(ws);
          void this.sendInitialSnapshot(ws);
        },
        message: (ws, rawMessage) => {
          let message: CommandCenterClientMessage;

          try {
            message = this.parseClientMessage(rawMessage);
          } catch (err) {
            logger.error(err as Error);
            this.send(ws, {
              type: 'commandResult',
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
            return;
          }

          this.handleClientMessage(ws, message).catch((err) => {
            logger.error(err as Error);
            this.send(ws, {
              type: 'commandResult',
              requestId: message.requestId,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        },
        close: (ws) => {
          this.clients.delete(ws);
        },
      },
    });

    this.unsubscribeOpenPositionsChange = this.bot.positionManager.onOpenPositionsChange(
      (positions) => {
        const previousOpenPositionIds = this.openPositionIds;
        this.openPositionIds = this.getOpenPositionIds(positions);
        const hasClosedPosition = Array.from(previousOpenPositionIds).some(
          (positionId) => !this.openPositionIds.has(positionId)
        );

        if (this.clients.size === 0) {
          return;
        }

        void this.broadcastSnapshot(hasClosedPosition);
      }
    );

    if (this.snapshotBroadcastInterval === null) {
      this.snapshotBroadcastInterval = setInterval(() => {
        if (this.clients.size > 0) {
          void this.broadcastSnapshot();
        }
      }, WebSocketCommandCenterServer.SNAPSHOT_BROADCAST_INTERVAL_MS);
    }

    if (this.marketScannerRealtimeInterval === null) {
      this.marketScannerRealtimeInterval = setInterval(() => {
        if (this.clients.size === 0) {
          return;
        }

        if (!this.marketScannerFeedEnabled) {
          this.lastMarketScannerSnapshotTimestamp = null;
          return;
        }

        const snapshot = this.bot.getMarketScannerSnapshot();
        const nextTimestamp = snapshot?.timestamp ?? null;

        if (nextTimestamp === this.lastMarketScannerSnapshotTimestamp) {
          return;
        }

        this.lastMarketScannerSnapshotTimestamp = nextTimestamp;
        this.broadcastMarketScannerSnapshot(snapshot);
      }, WebSocketCommandCenterServer.MARKET_SCANNER_REALTIME_POLL_INTERVAL_MS);
    }

    logger.info(`Command Center available at http://localhost:${this.port}`);
  }

  public stop(): void {
    this.unsubscribeOpenPositionsChange?.();
    this.unsubscribeOpenPositionsChange = null;

    if (this.snapshotBroadcastInterval !== null) {
      clearInterval(this.snapshotBroadcastInterval);
      this.snapshotBroadcastInterval = null;
    }

    if (this.marketScannerRealtimeInterval !== null) {
      clearInterval(this.marketScannerRealtimeInterval);
      this.marketScannerRealtimeInterval = null;
    }

    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    this.server?.stop(true);
    this.server = null;
    this.lastMarketScannerSnapshotTimestamp = null;
  }

  public isRunning(): boolean {
    return this.server !== null;
  }

  public getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  private async handleRequest(
    request: Request,
    server: Bun.Server<CommandCenterClientData>
  ): Promise<Response | undefined> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(request, {
        data: {
          id: crypto.randomUUID(),
        },
      });

      if (upgraded) {
        return undefined;
      }

      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    const apiResponse = await this.restApi.handleRequest(request);

    if (apiResponse !== null) {
      return apiResponse;
    }

    if (url.pathname === '/assets/app.js') {
      if (this.shouldUseEmbeddedFrontend()) {
        return new Response(commandCenterAppJs, {
          headers: {
            'content-type': 'text/javascript; charset=utf-8',
          },
        });
      }

      if (this.appJs === null || config.general.environment !== 'production') {
        this.appJs = await this.buildFrontendBundle();
      }

      return new Response(this.appJs ?? '', {
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
        },
      });
    }

    if (url.pathname === '/styles.css') {
      if (this.shouldUseEmbeddedFrontend()) {
        return new Response(commandCenterStylesCss, {
          headers: {
            'content-type': 'text/css; charset=utf-8',
          },
        });
      }

      return new Response(Bun.file(path.join(this.frontendDir, 'styles.css')), {
        headers: {
          'content-type': 'text/css; charset=utf-8',
        },
      });
    }

    if (this.shouldUseEmbeddedFrontend()) {
      return new Response(commandCenterIndexHtml, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      });
    }

    return new Response(Bun.file(path.join(this.frontendDir, 'index.html')), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    });
  }

  private shouldUseEmbeddedFrontend(): boolean {
    if (config.general.isBinary) {
      return true;
    }

    return !existsSync(path.join(this.frontendDir, 'src/main.tsx'));
  }

  private async buildFrontendBundle(): Promise<string> {
    const build = await Bun.build({
      entrypoints: [path.join(this.frontendDir, 'src/main.tsx')],
      minify: false,
      target: 'browser',
    });

    if (!build.success || build.outputs.length === 0) {
      const errors = build.logs.map((item) => item.message).join('\n');
      throw new Error(`Unable to build command center frontend:\n${errors}`);
    }

    return await build.outputs[0]!.text();
  }

  private parseClientMessage(rawMessage: string | Buffer): CommandCenterClientMessage {
    return JSON.parse(rawMessage.toString()) as CommandCenterClientMessage;
  }

  private async handleClientMessage(
    ws: Bun.ServerWebSocket<CommandCenterClientData>,
    message: CommandCenterClientMessage
  ): Promise<void> {

    if (message.type === 'syncPositions') {
      await this.bot.positionManager.syncPositionsFromExchange();
      this.send(ws, {
        type: 'commandResult',
        requestId: message.requestId,
        ok: true,
      });
      void this.broadcastSnapshot();
      return;
    }

    if (message.type === 'setMarketScannerFeed') {
      if (message.enabled) {
        await this.bot.ensureMarketScannerClientConnected();
      }

      this.marketScannerFeedEnabled = message.enabled;
      this.lastMarketScannerSnapshotTimestamp = null;
      this.send(ws, {
        type: 'commandResult',
        requestId: message.requestId,
        ok: true,
      });
      void this.broadcastSnapshot();
      return;
    }

    if (message.type === 'setMarketScannerMode') {
      try {
        if (message.enabled) {
          await this.bot.setMarketScannerModeEnabled(true);
          await this.bot.resume();
        } else {
          await this.bot.pause();
        }
      } catch (err) {
        this.send(ws, {
          type: 'commandResult',
          requestId: message.requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        void this.broadcastSnapshot();
        return;
      }

      this.send(ws, {
        type: 'commandResult',
        requestId: message.requestId,
        ok: true,
      });
      void this.broadcastSnapshot();
      return;
    }

    if (message.type === 'closePosition') {
      await this.closePositionFromCommandCenter(message.positionId);
      await this.refreshPositionHistorySnapshot();
      this.send(ws, {
        type: 'commandResult',
        requestId: message.requestId,
        ok: true,
        positionId: message.positionId,
      });
      void this.broadcastSnapshot();
      return;
    }

    if (message.type === 'openManualScannerPosition') {
      await this.bot.openManualScannerPosition(message.symbol, message.side);
      this.send(ws, {
        type: 'commandResult',
        requestId: message.requestId,
        ok: true,
      });
      void this.broadcastSnapshot();
      return;
    }
  }

  private async closePositionFromCommandCenter(positionId: string): Promise<void> {
    const position = this.bot.positionManager.getPositionById(positionId);

    if (!position) {
      throw new Error(`Position ${positionId} is not open`);
    }

    await this.bot.positionManager.closePosition(
      position.id,
      {
        strategyName: 'ManualCommandCenter',
        params: {
          source: 'websocket-command-center',
        },
        action: ExitStrategyAction.EXIT_CLOSE,
        kline: this.getCloseKline(position),
      },
      {
        forceMarket: true,
      }
    );
  }

  private getCloseKline(position: ALXPosition): ALXKline {
    const timeframe = this.bot.config.timeFrameToTrade;
    const latestKline = this.bot.exchange.getKlinesBuffer(position.symbol, timeframe)?.getLast();
    const currentPrice =
      this.bot.exchange.getCurrentPrice(position.symbol, timeframe) ?? latestKline?.close;

    if (latestKline && currentPrice !== undefined) {
      return {
        ...latestKline,
        close: currentPrice,
        high: Math.max(latestKline.high, currentPrice),
        low: Math.min(latestKline.low, currentPrice),
      };
    }

    const close = currentPrice ?? position.entryPrice;

    return {
      type: 'delta',
      pair: position.symbol,
      timeframe,
      timestamp: getCurrentTimestampMs(),
      open: close,
      high: close,
      low: close,
      close,
      buyCost: 0,
      sellCost: 0,
      buyVolume: 0,
      sellVolume: 0,
      liqBuyCost: 0,
      liqSellCost: 0,
      liqBuyVolume: 0,
      liqSellVolume: 0,
      tradeCount: 0,
      liqCount: 0,
    };
  }

  private async sendInitialSnapshot(
    ws: Bun.ServerWebSocket<CommandCenterClientData>
  ): Promise<void> {
    try {
      await this.refreshPositionHistorySnapshot();
      this.send(ws, {
        type: 'snapshot',
        payload: await this.getSnapshot({
          includeMarketScannerSnapshot: this.marketScannerFeedEnabled,
        }),
      });
    } catch (err) {
      logger.error(err as Error);
      this.send(ws, {
        type: 'commandResult',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private getOpenPositionIds(positions = this.bot.positionManager.getOpenPositions()) {
    return new Set(positions.map((position) => position.id));
  }

  private async getSnapshot({ includeMarketScannerSnapshot = true } = {}) {
    const shouldIncludeMarketScannerSnapshot =
      includeMarketScannerSnapshot && this.marketScannerFeedEnabled;

    return {
      updatedAt: getCurrentTimestampMs(),
      bot: {
        state: this.bot.getState(),
        mode: this.bot.mode,
        assetSymbol: this.bot.config.assetSymbol,
        timeframe: this.bot.config.timeFrameToTrade,
        marketScannerFeedEnabled: this.marketScannerFeedEnabled,
        marketScannerAutotradingEnabled: this.bot.getState() !== BotState.PAUSED,
        assetAutoReentryCooldownSeconds:
          this.bot.config.assetAutoReentryCooldownSeconds.value,
      },
      balance: this.bot.exchange.balanceManager.getBalanceSnapshot(),
      positions: this.bot.positionManager.getOpenPositions(),
      positionHistory: this.positionHistorySnapshot,
      marketScannerSnapshot: shouldIncludeMarketScannerSnapshot
        ? this.bot.getMarketScannerSnapshot()
        : null,
    };
  }

  private mapPositionHistorySnapshot(
    allPositions: JournalPosition[]
  ): CommandCenterPositionHistoryEntry[] {
    return allPositions
      .slice()
      .sort((left, right) => right.closeTimestamp - left.closeTimestamp)
      .slice(0, WebSocketCommandCenterServer.POSITION_HISTORY_LIMIT)
      .map((position) => ({
        id: position.id,
        symbol: position.symbol,
        side: position.side,
        entryPrice: position.entryPrice,
        closePrice: position.closePrice,
        quantity: position.quantity,
        margin: position.margin,
        leverage: position.leverage,
        openTimestamp: position.openTimestamp,
        closeTimestamp: position.closeTimestamp,
        realizedPnl: position.realizedPnl,
        mae: position.mae,
        minPnl: position.minPnl,
        maxPnl: position.maxPnl,
      }));
  }

  private async refreshPositionHistorySnapshot(): Promise<void> {
    const journalPositions = await getAllPositionHistory();
    this.positionHistorySnapshot = this.mapPositionHistorySnapshot(journalPositions);
  }

  private async broadcastSnapshot(refreshPositionHistory = false): Promise<void> {
    if (refreshPositionHistory) {
      await this.refreshPositionHistorySnapshot();
    }

    this.lastMarketScannerSnapshotTimestamp =
      this.bot.getMarketScannerSnapshot()?.timestamp ?? null;

    const message: CommandCenterServerMessage = {
      type: 'snapshot',
      payload: await this.getSnapshot({ includeMarketScannerSnapshot: false }),
    };
    const serializedMessage = JSON.stringify(message);

    for (const client of this.clients) {
      client.send(serializedMessage);
    }
  }

  private broadcastMarketScannerSnapshot(
    snapshot: ReturnType<SioBot['getMarketScannerSnapshot']>
  ): void {
    const message: CommandCenterServerMessage = {
      type: 'marketScannerSnapshot',
      payload: snapshot,
    };
    const serializedMessage = JSON.stringify(message);

    for (const client of this.clients) {
      client.send(serializedMessage);
    }
  }

  private send(
    ws: Bun.ServerWebSocket<CommandCenterClientData>,
    message: CommandCenterServerMessage
  ): void {
    ws.send(JSON.stringify(message));
  }
}
