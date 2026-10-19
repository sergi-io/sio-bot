import type { ALXKline } from '@/domain/ALXKline';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import { config } from '@/config';

export type NexusQueryRangeRequest = {
  queryType: 'range';
  pair: string;
  timeframes: ALXTimeFrame[];
  startDate: number;
  endDate: number;
  limit?: number;
};

export type NexusQueryLastRequest = {
  queryType: 'last';
  pair: string;
  timeframes: ALXTimeFrame[];
  limit: number;
};

export type NexusQueryInfoRequest = {
  queryType: 'info';
};

export type NexusInfoRange = {
  tableName: string;
  pair: string;
  timeframe: ALXTimeFrame;
  range: {
    startDate: number | null;
    endDate: number | null;
  };
  count: number;
  noGapRanges: Array<{
    startDate: number;
    endDate: number;
    count: number;
  }>;
};

export type NexusInfoTimeframe = {
  timeframe: ALXTimeFrame;
  label: string;
  milliseconds: number;
};

export type NexusInfoResult = {
  ranges: NexusInfoRange[];
  timeframes: NexusInfoTimeframe[];
};

type EndResponse = { type: 'end'; count: number };
type ErrorResponse = { type: 'error'; message: string };
type KlineResponse = {
  type: 'kline';
  kline: ALXKline;
};
type InfoResponse = {
  type: 'info';
  info: NexusInfoResult;
};
type ServerResponse = KlineResponse | EndResponse | ErrorResponse | InfoResponse;
type QueryRequest = NexusQueryRangeRequest | NexusQueryLastRequest;
type QueryCacheEntry = {
  expiresAt: number;
  klines: ALXKline[];
};

export class NexusQuerySocketClient {
  private static readonly QUERY_CACHE_TTL_MS = 15 * 60 * 1000;
  private static readonly queryCache = new Map<string, QueryCacheEntry>();
  private static readonly pendingQueries = new Map<string, Promise<ALXKline[]>>();

  query(req: QueryRequest): Promise<ALXKline[]> {
    const cacheKey = NexusQuerySocketClient.getQueryCacheKey(req);
    const now = Date.now();

    NexusQuerySocketClient.pruneExpiredQueryCache(now);

    const cachedEntry = NexusQuerySocketClient.queryCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > now) {
      return Promise.resolve(NexusQuerySocketClient.cloneKlines(cachedEntry.klines));
    }

    if (cachedEntry) {
      NexusQuerySocketClient.queryCache.delete(cacheKey);
    }

    const pendingQuery = NexusQuerySocketClient.pendingQueries.get(cacheKey);
    if (pendingQuery) {
      return pendingQuery.then((klines) => NexusQuerySocketClient.cloneKlines(klines));
    }

    const queryPromise = this.executeQuery(req)
      .then((klines) => {
        const snapshot = NexusQuerySocketClient.cloneKlines(klines);
        NexusQuerySocketClient.queryCache.set(cacheKey, {
          expiresAt: Date.now() + NexusQuerySocketClient.QUERY_CACHE_TTL_MS,
          klines: snapshot,
        });
        return snapshot;
      })
      .finally(() => {
        NexusQuerySocketClient.pendingQueries.delete(cacheKey);
      });

    NexusQuerySocketClient.pendingQueries.set(cacheKey, queryPromise);

    return queryPromise.then((klines) => NexusQuerySocketClient.cloneKlines(klines));
  }

  private executeQuery(req: QueryRequest): Promise<ALXKline[]> {
    const socketPath = config.nexus.queryUnixSocketPath;
    const klines: ALXKline[] = [];

    return new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;
      let receivedEnd = false;

      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      Bun.connect({
        unix: socketPath,
        socket: {
          open: (s) => {
            s.write(JSON.stringify(req) + '\n');
          },
          data: (s, data) => {
            buffer += data.toString();
            let newlineIdx: number;
            while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newlineIdx).trim();
              buffer = buffer.slice(newlineIdx + 1);
              if (!line) continue;

              let msg: ServerResponse;
              try {
                msg = JSON.parse(line) as ServerResponse;
              } catch {
                settle(() => reject(new Error(`Failed to parse query socket response: ${line}`)));
                return;
              }

              if (msg.type === 'error') {
                settle(() => reject(new Error(`Nexus query error: ${msg.message}`)));
                return;
              }

              if (msg.type === 'end') {
                receivedEnd = true;
                settle(() => resolve(klines));
                s.end();
                return;
              }

              if (msg.type === 'kline') {
                klines.push(msg.kline);
                continue;
              }

              if (msg.type === 'info') {
                settle(() =>
                  reject(new Error('Unexpected info response while waiting for klines'))
                );
                return;
              }

              /* @ts-expect-error - exhaustive check */
              settle(() => reject(new Error(`Unknown query socket response type: ${msg.type}`)));
              return;
            }
          },
          error: (_s, err) => {
            settle(() => reject(err));
          },
          close: () => {
            if (receivedEnd) {
              settle(() => resolve(klines));
              return;
            }

            settle(() =>
              reject(
                new Error(
                  `Query socket closed before sending the end marker for ${req.queryType} query`
                )
              )
            );
          },
        },
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `❌ FATAL: Cannot connect to NexusQuerySocket at "${socketPath}": ${message}\nSioBot will now exit.`
        );
        process.exit(1);
      });
    });
  }

  private static getQueryCacheKey(req: QueryRequest): string {
    if (req.queryType === 'range') {
      return [
        req.queryType,
        req.pair,
        req.timeframes.join(','),
        req.startDate,
        req.endDate,
        req.limit ?? '',
      ].join('|');
    }

    return [req.queryType, req.pair, req.timeframes.join(','), req.limit].join('|');
  }

  private static pruneExpiredQueryCache(now: number): void {
    for (const [cacheKey, entry] of NexusQuerySocketClient.queryCache.entries()) {
      if (entry.expiresAt <= now) {
        NexusQuerySocketClient.queryCache.delete(cacheKey);
      }
    }
  }

  private static cloneKlines(klines: ALXKline[]): ALXKline[] {
    return klines.map((kline) => ({ ...kline }));
  }

  queryInfo(): Promise<NexusInfoResult> {
    const socketPath = config.nexus.queryUnixSocketPath;

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
          open: (s) => {
            const request: NexusQueryInfoRequest = { queryType: 'info' };
            s.write(JSON.stringify(request) + '\n');
          },
          data: (s, data) => {
            buffer += data.toString();
            let newlineIdx: number;
            while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newlineIdx).trim();
              buffer = buffer.slice(newlineIdx + 1);
              if (!line) continue;

              let msg: ServerResponse;
              try {
                msg = JSON.parse(line) as ServerResponse;
              } catch {
                settle(() => reject(new Error(`Failed to parse query socket response: ${line}`)));
                return;
              }

              if (msg.type === 'error') {
                settle(() => reject(new Error(`Nexus query error: ${msg.message}`)));
                return;
              }

              if (msg.type === 'info') {
                settle(() => resolve(msg.info));
                s.end();
                return;
              }

              if (msg.type === 'kline' || msg.type === 'end') {
                settle(() =>
                  reject(new Error(`Unexpected query socket response type for info: ${msg.type}`))
                );
                return;
              }

              /* @ts-expect-error - exhaustive check */
              settle(() => reject(new Error(`Unknown query socket response type: ${msg.type}`)));
              return;
            }
          },
          error: (_s, err) => {
            settle(() => reject(err));
          },
          close: () => {
            settle(() => reject(new Error('Socket closed before receiving info response')));
          },
        },
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `❌ FATAL: Cannot connect to NexusQuerySocket at "${socketPath}": ${message}\nSioBot will now exit.`
        );
        process.exit(1);
      });
    });
  }
}
