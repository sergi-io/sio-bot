import type { SioBot } from '@/siobot/SioBot';
import { type ALXPosition } from '@/domain/ALXPosition';
import { logger, silentLogger } from '@/utils/logger';

export class RiskStrategyBase {
  public bot: SioBot;
  protected logger: typeof logger = logger;

  constructor(bot: SioBot) {
    this.bot = bot;
    if (this.bot.isBackTesting()) {
      this.logger = silentLogger as typeof logger; // silentLogger as typeof logger;
    }
  }

  /**
   * Get all open positions for a specific symbol
   */
  public getPositionsBySymbol(symbol: string): ALXPosition[] {
    return this.bot.positionManager.getOpenPositions().filter((p) => p.symbol === symbol);
  }
}
