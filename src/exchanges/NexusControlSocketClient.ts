import { config } from '@/config';
import { logger } from '@/utils/logger';

export type NexusControlExchangeId = 'binance' | 'binanceusdm' | 'phemex' | 'bitget';

export type NexusControlSubscribeRequest = {
  action: 'subscribe';
  pair: string;
  exchangeId: NexusControlExchangeId;
  symbol: string;
  persistToDb: boolean;
  mainPriceTracker?: boolean;
};

export type NexusControlUnsubscribeRequest = {
  action: 'unsubscribe';
  pair: string;
  exchangeId: NexusControlExchangeId;
  symbol: string;
};

export type NexusControlListRequest = {
  action: 'list';
};

export type NexusControlRequest =
  | NexusControlSubscribeRequest
  | NexusControlUnsubscribeRequest
  | NexusControlListRequest;

type OkResponse = {
  type: 'ok';
  action: 'subscribe' | 'unsubscribe';
};
type ErrorResponse = { type: 'error'; message: string };
type SubscriptionsResponse = { type: 'subscriptions'; items: unknown[] };
type NexusControlResponse = OkResponse | ErrorResponse | SubscriptionsResponse;

export class NexusControlSocketClient {
  async send(request: NexusControlRequest): Promise<NexusControlResponse> {
    const socketPath = config.nexus.controlUnixSocketPath;

    return new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;

      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      Bun.connect({
        unix: socketPath,
        socket: {
          open: (socket) => {
            socket.write(JSON.stringify(request) + '\n');
          },
          data: (socket, data) => {
            buffer += data.toString();
            let newlineIdx: number;
            while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newlineIdx).trim();
              buffer = buffer.slice(newlineIdx + 1);
              if (!line) continue;

              let response: NexusControlResponse;
              try {
                response = JSON.parse(line) as NexusControlResponse;
              } catch {
                settle(() => reject(new Error(`Failed to parse Nexus control response: ${line}`)));
                socket.end();
                return;
              }

              if (response.type === 'error') {
                settle(() => reject(new Error(`Nexus control error: ${response.message}`)));
                socket.end();
                return;
              }

              settle(() => resolve(response));
              socket.end();
              return;
            }
          },
          error: (_socket, error) => {
            settle(() => reject(error));
          },
          close: () => {
            settle(() => reject(new Error('Nexus control socket closed before responding')));
          },
        },
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        reject(new Error(`Cannot connect to Nexus control socket at "${socketPath}": ${message}`));
      });
    });
  }

  async subscribe(requests: NexusControlSubscribeRequest[]): Promise<void> {
    for (const request of requests) {
      logger.info(
        `Subscribing Nexus source ${request.exchangeId}:${request.symbol} -> ${request.pair}`
      );
      await this.send(request);
    }
  }

  async unsubscribe(requests: NexusControlUnsubscribeRequest[]): Promise<void> {
    for (const request of requests) {
      logger.info(
        `Unsubscribing Nexus source ${request.exchangeId}:${request.symbol} -> ${request.pair}`
      );
      await this.send(request);
    }
  }
}
