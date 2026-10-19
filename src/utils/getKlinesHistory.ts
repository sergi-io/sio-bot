import type { ALXKline } from '@/domain/ALXKline';
import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';
import { NexusQuerySocketClient } from '@/exchanges/NexusQuerySocketClient';
import { logger } from '@/utils/logger';
import { sleep } from 'bun';

type GetKlinesRangeParams = {
  symbol: string;
  startTimestampMs: number;
  endTimestampMs: number;
  timeframes: ALXTimeFrame[];
  limit?: number;
  log?: boolean;
};

type GetKlinesLastParams = {
  symbol: string;
  timeframes: ALXTimeFrame[];
  limit: number;
  log?: boolean;
};

const client = new NexusQuerySocketClient();
const MAX_QUERY_ATTEMPTS = 3;
const QUERY_RETRY_DELAY_MS = 250;

async function queryWithRetries(
  queryFn: () => Promise<ALXKline[]>,
  description: string
): Promise<ALXKline[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_QUERY_ATTEMPTS; attempt++) {
    try {
      return await queryFn();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_QUERY_ATTEMPTS) {
        break;
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `${description} failed on attempt ${attempt}/${MAX_QUERY_ATTEMPTS}: ${message}. Retrying...`
      );
      await sleep(QUERY_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function getKlinesHistoryRange({
  symbol,
  startTimestampMs,
  endTimestampMs,
  timeframes,
  limit,
  log = false,
}: GetKlinesRangeParams): Promise<ALXKline[]> {
  if (log) {
    logger.debug(
      `[getKlinesRange] Querying [${symbol}] [${timeframes.join(',')}] from ${new Date(startTimestampMs).toISOString()} to ${new Date(endTimestampMs).toISOString()}`
    );
  }

  const klines = await queryWithRetries(
    () =>
      client.query({
        queryType: 'range',
        pair: symbol,
        timeframes,
        startDate: startTimestampMs,
        endDate: endTimestampMs,
        limit,
      }),
    `[getKlinesRange] Querying [${symbol}] [${timeframes.join(',')}]`
  );

  if (log) {
    logger.debug(`[getKlinesRange] Received ${klines.length} klines`);
  }

  return klines;
}

export async function getKlinesHistoryLast({
  symbol,
  timeframes,
  limit,
  log = false,
}: GetKlinesLastParams): Promise<ALXKline[]> {
  if (log) {
    logger.debug(
      `[getKlinesLast] Querying [${symbol}] [${timeframes.join(',')}] with limit ${limit}`
    );
  }

  const klines = await queryWithRetries(
    () =>
      client.query({
        queryType: 'last',
        pair: symbol,
        timeframes,
        limit,
      }),
    `[getKlinesLast] Querying [${symbol}] [${timeframes.join(',')}]`
  );

  // Test that klines are in the correct order (newest to oldest)
  for (let i = 0; i < klines.length; i++) {
    if (
      i > 0 &&
      klines[i]!.timestamp < klines[i - 1]!.timestamp &&
      klines[i]!.timeframe === klines[i - 1]!.timeframe
    ) {
      logger.warn(
        `[getKlinesLast] Klines are not in the correct order: ${klines[i - 1]!.timestamp} followed by ${klines[i]!.timestamp}`
      );
    }
  }

  if (log) {
    logger.debug(`[getKlinesLast] Received ${klines.length} klines`);
  }

  return klines;
}
