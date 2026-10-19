import type { ALXKline } from '@/domain/ALXKline';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import { config } from '@/config';
import { logger } from '@/utils/logger';

type NexusAggrMessage = ALXKline;

type SubscriptionKey = string; // "symbol:timeframe"
type KlineHandler = (kline: ALXKline) => Promise<void>;

function makeKey(symbol: string, timeframe: ALXTimeFrame): SubscriptionKey {
  return `${symbol}:${timeframe}`;
}

export class NexusAggrSocketClient {
  private socket: ReturnType<typeof Bun.connect> | null = null;
  private subscriptions = new Map<SubscriptionKey, KlineHandler>();
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private buffer = '';

  async connect(): Promise<void> {
    const socketPath = config.nexus.aggrSocketPath;
    logger.info(`Connecting to Nexus socket at ${socketPath}`);

    return new Promise((resolve, reject) => {
      this.socket = Bun.connect({
        unix: socketPath,
        socket: {
          open: () => {
            this.connected = true;
            logger.info('Nexus socket connected');
            resolve();
          },
          data: (_socket, data) => {
            this.handleData(data);
          },
          close: () => {
            this.connected = false;
            logger.warn('Nexus socket disconnected');
            this.scheduleReconnect();
          },
          error: (_socket, error) => {
            logger.error(`Nexus socket error: ${error.message}`);
            if (!this.connected) {
              reject(error);
            }
          },
        },
      });
    });
  }

  private handleData(data: Buffer | Uint8Array): void {
    this.buffer += data.toString();

    // Process newline-delimited JSON messages
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const msg = JSON.parse(line) as NexusAggrMessage;
        if (msg.type === 'full' || msg.type === 'delta') {
          if (!msg.close) {
            logger.error(`Received incomplete kline data from Nexus: ${line}`);
          }
          this.dispatchMessage(msg);
        }
      } catch (err) {
        logger.error(`Failed to parse Nexus message: ${err}`);
      }
    }
  }

  private dispatchMessage(msg: NexusAggrMessage): void {
    const key = makeKey(msg.pair, msg.timeframe as ALXTimeFrame);
    const handler = this.subscriptions.get(key);
    if (handler) {
      const kline: ALXKline = msg;
      handler(kline).catch((err) => {
        logger.error(`Error in Nexus kline handler: ${err}`);
      });
    }
  }

  subscribe(symbol: string, timeframes: ALXTimeFrame[], handler: KlineHandler): void {
    for (const tf of timeframes) {
      const key = makeKey(symbol, tf);
      this.subscriptions.set(key, handler);
      logger.trace(`Subscribed to Nexus klines for ${key}`);
    }
  }

  unsubscribe(symbol: string, timeframes: ALXTimeFrame[]): void {
    for (const tf of timeframes) {
      const key = makeKey(symbol, tf);
      this.subscriptions.delete(key);
      logger.trace(`Unsubscribed from Nexus klines for ${key}`);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      logger.info('Attempting Nexus socket reconnection...');
      try {
        await this.connect();
      } catch (err) {
        logger.error(`Nexus reconnection failed: ${err}`);
        this.scheduleReconnect();
      }
    }, 3000);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      (this.socket as any).end?.();
      this.socket = null;
    }
    this.connected = false;
    this.subscriptions.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }
}
