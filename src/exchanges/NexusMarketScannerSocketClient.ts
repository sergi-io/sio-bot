import type { Socket } from 'bun';
import { config } from '@/config';
import { logger } from '@/utils/logger';

export type NexusMarketScannerSymbolStats = {
  exchangeId: string;
  symbol: string;
  lastPrice: number;
  timestamp: number;
  lastTradeTimestamp: number;
  tradeCount: number;
  tradesPerSecond: number;
  buyCount: number;
  sellCount: number;
  buyCost: number;
  sellCost: number;
  buyVolume: number;
  sellVolume: number;
  totalCost: number;
  totalVolume: number;
  netCost: number;
  volumeDelta?: number;
  costDelta?: number;
  volumeDeltaImbalance?: number;
  costDeltaImbalance?: number;
  vwap: number;
  open: number;
  high: number;
  low: number;
  priceChangeAbs: number;
  priceChangePct: number;
  priceChange1mAbs?: number;
  priceChange1mPct?: number;
  priceChange5mAbs?: number;
  priceChange5mPct?: number;
  priceChange15mAbs?: number;
  priceChange15mPct?: number;
};

export type NexusMarketScannerSnapshot = {
  type: 'market-scanner-snapshot';
  exchangeId: string;
  timestamp: number;
  windowMs: number;
  symbolsCount: number;
  activeSymbolsCount: number;
  symbols: NexusMarketScannerSymbolStats[];
};

type NexusMarketScannerMessage =
  | NexusMarketScannerSnapshot
  | { type: 'market-scanner-started'; exchangeId: string }
  | { type: 'market-scanner-error'; exchangeId?: string; message?: string; error?: string };

export class NexusMarketScannerSocketClient {
  private static readonly MAX_UNTERMINATED_BUFFER_LENGTH = 10 * 1024 * 1024;
  private static readonly MAX_UNTERMINATED_BUFFER_AGE_MS = 5_000;

  private socket: Socket<unknown> | null = null;
  private buffer = '';
  private readonly decoder = new TextDecoder();
  private connected = false;
  private intentionallyDisconnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private unterminatedBufferStartedAt: number | null = null;
  private latestSnapshot: NexusMarketScannerSnapshot | null = null;
  private snapshotListeners = new Set<(snapshot: NexusMarketScannerSnapshot) => void>();

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const socketPath = config.nexus.scannerUnixSocketPath;
    logger.info(`Connecting to Nexus market scanner socket at ${socketPath}`);
    this.intentionallyDisconnected = false;

    return new Promise((resolve, reject) => {
      void Bun.connect({
        unix: socketPath,
        socket: {
          open: (socket) => {
            this.socket = socket;
            this.connected = true;
            logger.info('Nexus market scanner socket connected');
            resolve();
          },
          data: (_socket, data) => {
            this.handleData(data);
          },
          close: () => {
            this.connected = false;
            this.socket = null;
            this.buffer = '';
            this.unterminatedBufferStartedAt = null;
            logger.warn('Nexus market scanner socket disconnected');
            if (!this.intentionallyDisconnected) {
              this.scheduleReconnect();
            }
          },
          error: (_socket, error) => {
            logger.error(`Nexus market scanner socket error: ${error.message}`);
            if (!this.connected) {
              reject(error);
            }
          },
        },
      }).catch((error) => {
        if (!this.connected) {
          reject(error);
        }
      });
    });
  }

  disconnect(): void {
    this.intentionallyDisconnected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      (this.socket as any).end?.();
      this.socket = null;
    }
    this.connected = false;
    this.buffer = '';
    this.unterminatedBufferStartedAt = null;
  }

  getLatestSnapshot(): NexusMarketScannerSnapshot | null {
    return this.latestSnapshot;
  }

  onSnapshot(listener: (snapshot: NexusMarketScannerSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  private handleData(data: Buffer | Uint8Array): void {
    this.buffer += this.decoder.decode(data, { stream: true });
    let newlineIdx: number;
    if (this.buffer.indexOf('\n') === -1) {
      this.handleUnterminatedBuffer();
      return;
    }

    this.unterminatedBufferStartedAt = null;

    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (!line) {
        continue;
      }

      const message = this.parseMessage(line);
      if (message === null) {
        continue;
      }

      if (message.type === 'market-scanner-snapshot') {
        this.latestSnapshot = message;
        for (const listener of this.snapshotListeners) {
          listener(message);
        }
      } else if (message.type === 'market-scanner-error') {
        logger.warn(
          `Nexus market scanner error: ${message.message ?? message.error ?? 'unknown error'}`
        );
      }
    }

    if (this.buffer.length > 0) {
      this.unterminatedBufferStartedAt = Date.now();
    }
  }

  private parseMessage(line: string): NexusMarketScannerMessage | null {
    try {
      return JSON.parse(line) as NexusMarketScannerMessage;
    } catch (error) {
      const recoveredMessage = this.tryRecoverMessage(line);
      if (recoveredMessage !== null) {
        return recoveredMessage;
      }

      logger.error(`Failed to parse Nexus market scanner message: ${error}`);
      return null;
    }
  }

  private tryRecoverMessage(line: string): NexusMarketScannerMessage | null {
    const messageStartPattern = '{"type":"market-scanner-';
    let messageStart = line.lastIndexOf(messageStartPattern);

    while (messageStart !== -1) {
      const candidate = line.slice(messageStart);
      try {
        return JSON.parse(candidate) as NexusMarketScannerMessage;
      } catch {
        messageStart = line.lastIndexOf(messageStartPattern, messageStart - 1);
      }
    }

    return null;
  }

  private handleUnterminatedBuffer(): void {
    const now = Date.now();
    this.unterminatedBufferStartedAt ??= now;

    const bufferAgeMs = now - this.unterminatedBufferStartedAt;
    if (
      this.buffer.length < NexusMarketScannerSocketClient.MAX_UNTERMINATED_BUFFER_LENGTH &&
      bufferAgeMs < NexusMarketScannerSocketClient.MAX_UNTERMINATED_BUFFER_AGE_MS
    ) {
      return;
    }

    logger.warn(
      `Nexus market scanner stream desynchronized; reconnecting after ${this.buffer.length} bytes without newline`
    );
    this.buffer = '';
    this.unterminatedBufferStartedAt = null;
    (this.socket as any)?.end?.();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.intentionallyDisconnected) {
      return;
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.connected || this.intentionallyDisconnected) {
        return;
      }

      try {
        await this.connect();
      } catch (error) {
        logger.error(`Nexus market scanner reconnection failed: ${error}`);
        this.scheduleReconnect();
      }
    }, 1_000);
  }
}
