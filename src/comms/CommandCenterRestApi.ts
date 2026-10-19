import type { JournalData } from '@/journal/types';
import { buildJournalData } from '@/journal/utils/dataTransformer';
import { getAllPositionHistory } from '@/utils/db/positionHistory/getAllPositionHistory';
import { logger } from '@/utils/logger';

export class CommandCenterRestApi {
  public async handleRequest(request: Request): Promise<Response | null> {
    const url = new URL(request.url);

    if (url.pathname === '/api/trading-journal') {
      return await this.handleTradingJournalRequest(request);
    }

    return null;
  }

  private async handleTradingJournalRequest(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return Response.json(
        {
          error: 'Method not allowed',
        },
        {
          status: 405,
          headers: {
            allow: 'GET',
          },
        }
      );
    }

    try {
      return Response.json(await this.loadJournalData(), {
        headers: {
          'cache-control': 'no-store',
        },
      });
    } catch (err) {
      logger.error(err as Error);
      return Response.json(
        {
          error: err instanceof Error ? err.message : String(err),
        },
        {
          status: 500,
        }
      );
    }
  }

  private async loadJournalData(): Promise<JournalData> {
    const journalPositions = await getAllPositionHistory();
    return buildJournalData(journalPositions);
  }
}
