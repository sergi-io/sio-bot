import { SioBot } from '@/siobot/SioBot';
import { BotConfig } from '@/siobot/BotConfig';
import { BotRunMode } from '@/siobot/constants';
import type { ALXKline } from '@/domain/ALXKline';
import { ALXPositionSide, type ALXPosition } from '@/domain/ALXPosition';
import { FakeExchange } from '@/exchanges/FakeExchange/FakeExchange';
import { calcDurationMs, formatDateFromMs, formatDateTimeFromMs } from '@/utils/date';
import { formatMoney } from '@/utils/money';
import ansis from 'ansis';
import { ReportGenerator } from './reportGenerator/ReportGenerator';
import { PnlCurveReportGenerator } from './reportGenerator/PnlCurveReportGenerator';
import { config } from '@/config';
import { sleep } from 'bun';
import { percentile } from '@/utils/percentile';
import {
  calculateProfitFactor,
  calculateSharpeRatio,
  formatPerformanceMetric,
} from './performanceMetrics';

export interface BackTestConfig {
  botConfig?: BotConfig;
  initialBalance?: number;
  historicalKlines?: ALXKline[];
  printReport?: boolean;
  slowMotionFactor?: number; // If set, the backtest will run in slow motion with the given factor (e.g. 0.5 will make it run at half speed)
}

export interface BackTestSideStats {
  executed: number;
  closed: number;
  open: number;
  winRate: number;
  pnl: number;
}

export interface BackTestStrategyStats {
  strategyName: string;
  used: number;
  closed: number;
  open: number;
  winRate: number;
  averagePnl: number;
  pnl: number;
}

export interface BackTestStrategyStatsCollection {
  entryStrategies: BackTestStrategyStats[];
  exitStrategies: BackTestStrategyStats[];
}

export interface BackTestOutput {
  initialBalance: number;
  finalBalance: number;
  pnl: number;
  p10Pnl: number; // 20th percentile PnL of closed positions (robust to outliers) (we want worse case scenarios)
  sharpeRatio: number;
  profitFactor: number;
  winRate: number;
  potentialMaxProfit: number;
  potentialMaxLoss: number;
  p95MAE: number;
  maxMAE: number; // This takes into account the margin used per position
  lowerPositionPnl: number;
  p50PositionDurationMs: number;
  maxPositionDurationMs: number;
  sideStats: Record<ALXPositionSide, BackTestSideStats>;
  strategyStats: BackTestStrategyStatsCollection;
  positions: ALXPosition[];
  klines: ALXKline[];
}

type StrategyStatsAccumulator = BackTestStrategyStats & {
  wins: number;
};

export class BackTester {
  private bot: SioBot | null = null;
  private backTestConfig: BackTestConfig | null = null;
  private botConfig: BotConfig;
  private initialBalance: number = config.backTest.initialBalance;
  private slowMotionFactor: number = 0;

  public constructor(params?: BackTestConfig) {
    this.botConfig = params?.botConfig ?? new BotConfig();
    this.backTestConfig = params ?? null;
    this.slowMotionFactor = params?.slowMotionFactor ?? 0;

    if (typeof params?.initialBalance === 'number') {
      this.initialBalance = params.initialBalance;
    }
  }

  public async run(): Promise<BackTestOutput> {
    const exchange = new FakeExchange({
      initialBalance: this.initialBalance,
      historicalKlines: this.backTestConfig?.historicalKlines,
      klineHistoricalDataRange: {
        dateStart: this.botConfig?.backtestStartTimestampMs ?? 0,
        dateEnd: this.botConfig?.backtestEndTimestampMs ?? 0,
      },
      silent: true,
    });
    this.bot = new SioBot({
      mode: BotRunMode.BACKTEST,
      exchange,
      botConfig: this.botConfig,
    });

    if (this.slowMotionFactor > 0) {
      this.slowMotion(this.slowMotionFactor);
    }
    await this.bot.run();

    if (this.backTestConfig?.printReport) {
      await sleep(1000);
      await this.printReport();
    }
    return this.generateOutput();
  }

  public async generateOutput(): Promise<BackTestOutput> {
    if (!this.bot) {
      throw new Error('BackTester: Bot has not been run yet.');
    }

    const klines: ALXKline[] =
      this.bot.exchange instanceof FakeExchange ? this.bot.exchange.getHistoricalKlines() : [];

    let potentialMaxLoss = 0;
    let potentialMaxProfit = 0;
    let lowerPositionPnl = 0;
    let winRate = 0;
    let maxPositionDurationMs = 0;
    let maxMAE = 0;
    let p95MAE = 0;
    let p50PositionDurationMs = 0;
    const MAEs: number[] = [];
    const positionDurations: number[] = [];

    const closedPositions = this.bot.positionManager.getClosedPositions();
    const openPositions = this.bot.positionManager.getOpenPositions();

    const positions = [...closedPositions, ...openPositions];
    const sideStats = this.calculateSideStats(positions);
    const strategyStats = this.calculateStrategyStats(positions);
    const sharpeRatio = calculateSharpeRatio(closedPositions);
    const profitFactor = calculateProfitFactor(closedPositions);

    positions.forEach((pos) => {
      potentialMaxProfit += pos.maxRealizedPnl ?? 0;
      potentialMaxLoss += pos.minRealizedPnl ?? 0;
      lowerPositionPnl = Math.min(lowerPositionPnl, pos.minRealizedPnl ?? 0);
      maxMAE = Math.min(pos.mae, maxMAE);
      MAEs.push(pos.mae);

      if (pos.closeTimestamp !== undefined) {
        maxPositionDurationMs = Math.max(
          maxPositionDurationMs,
          pos.closeTimestamp! - pos.openTimestamp
        );
        positionDurations.push(pos.closeTimestamp! - pos.openTimestamp);
      }
      if (pos.realizedPnl > 0) {
        winRate += 1;
      }
    });

    p50PositionDurationMs = closedPositions.length > 0 ? percentile(positionDurations, 0.5) : 0;
    winRate = closedPositions.length > 0 ? (winRate / closedPositions.length) * 100 : 0;
    p95MAE = positions.length > 0 ? percentile(MAEs, 0.95) : 0;

    const pnlPositionsOpened = openPositions.reduce((sum, pos) => sum + (pos.realizedPnl || 0), 0);

    const finalBalance = (await this.bot.exchange.getBalance()) + pnlPositionsOpened;

    return {
      initialBalance: this.initialBalance,
      finalBalance: finalBalance,
      pnl: finalBalance - this.initialBalance,
      p10Pnl:
        closedPositions.length > 0
          ? percentile(
              closedPositions.map((p) => p.realizedPnl),
              0.1
            )
          : 0,
      sharpeRatio,
      profitFactor,
      potentialMaxProfit,
      potentialMaxLoss,
      maxMAE,
      p95MAE,
      winRate,
      lowerPositionPnl,
      p50PositionDurationMs,
      maxPositionDurationMs,
      sideStats,
      strategyStats,
      positions,
      klines,
    };
  }

  private createEmptySideStats(): BackTestSideStats {
    return {
      executed: 0,
      closed: 0,
      open: 0,
      winRate: 0,
      pnl: 0,
    };
  }

  private calculateSideStats(
    positions: ALXPosition[]
  ): Record<ALXPositionSide, BackTestSideStats> {
    const sideStats: Record<ALXPositionSide, BackTestSideStats> = {
      [ALXPositionSide.LONG]: this.createEmptySideStats(),
      [ALXPositionSide.SHORT]: this.createEmptySideStats(),
    };

    positions.forEach((position) => {
      const stats = sideStats[position.side];

      stats.executed += 1;
      stats.pnl += position.realizedPnl;

      if (position.closeTimestamp !== undefined) {
        stats.closed += 1;

        if (position.realizedPnl > 0) {
          stats.winRate += 1;
        }
      } else {
        stats.open += 1;
      }
    });

    Object.values(sideStats).forEach((stats) => {
      stats.winRate = stats.closed > 0 ? (stats.winRate / stats.closed) * 100 : 0;
    });

    return sideStats;
  }

  private createEmptyStrategyStats(strategyName: string): StrategyStatsAccumulator {
    return {
      strategyName,
      used: 0,
      closed: 0,
      open: 0,
      winRate: 0,
      averagePnl: 0,
      pnl: 0,
      wins: 0,
    };
  }

  private addStrategyStatsEntry({
    statsMap,
    strategyName,
    pnl,
    isClosed,
    isWinningPosition,
  }: {
    statsMap: Map<string, StrategyStatsAccumulator>;
    strategyName: string;
    pnl: number;
    isClosed: boolean;
    isWinningPosition: boolean;
  }): void {
    const normalizedStrategyName = strategyName || 'Unknown';
    const stats =
      statsMap.get(normalizedStrategyName) ??
      this.createEmptyStrategyStats(normalizedStrategyName);

    stats.used += 1;
    stats.pnl += pnl;

    if (isClosed) {
      stats.closed += 1;
      if (isWinningPosition) {
        stats.wins += 1;
      }
    } else {
      stats.open += 1;
    }

    statsMap.set(normalizedStrategyName, stats);
  }

  private finalizeStrategyStats(
    statsMap: Map<string, StrategyStatsAccumulator>
  ): BackTestStrategyStats[] {
    return Array.from(statsMap.values())
      .map(({ wins, ...stats }) => ({
        ...stats,
        winRate: stats.closed > 0 ? (wins / stats.closed) * 100 : 0,
        averagePnl: stats.used > 0 ? stats.pnl / stats.used : 0,
      }))
      .sort((left, right) => {
        if (right.pnl !== left.pnl) {
          return right.pnl - left.pnl;
        }
        if (right.used !== left.used) {
          return right.used - left.used;
        }
        return left.strategyName.localeCompare(right.strategyName);
      });
  }

  private calculateStrategyStats(positions: ALXPosition[]): BackTestStrategyStatsCollection {
    const entryStats = new Map<string, StrategyStatsAccumulator>();
    const exitStats = new Map<string, StrategyStatsAccumulator>();

    positions.forEach((position) => {
      const isClosed = position.closeTimestamp !== undefined;
      const isWinningPosition = isClosed && position.realizedPnl > 0;
      const openedByStrategies = position.openedByStrategies ?? [];
      const entryPnlShare =
        openedByStrategies.length > 0
          ? position.realizedPnl / openedByStrategies.length
          : position.realizedPnl;

      if (openedByStrategies.length === 0) {
        this.addStrategyStatsEntry({
          statsMap: entryStats,
          strategyName: 'Unknown',
          pnl: entryPnlShare,
          isClosed,
          isWinningPosition,
        });
      } else {
        openedByStrategies.forEach((strategy) => {
          this.addStrategyStatsEntry({
            statsMap: entryStats,
            strategyName: strategy.strategyName,
            pnl: entryPnlShare,
            isClosed,
            isWinningPosition,
          });
        });
      }

      if (isClosed) {
        this.addStrategyStatsEntry({
          statsMap: exitStats,
          strategyName: position.closedByStrategy?.strategyName ?? 'Unknown',
          pnl: position.realizedPnl,
          isClosed,
          isWinningPosition,
        });
      }
    });

    return {
      entryStrategies: this.finalizeStrategyStats(entryStats),
      exitStrategies: this.finalizeStrategyStats(exitStats),
    };
  }

  public async slowMotion(factor: number) {
    this.slowMotionFactor = factor;
    const fakeExchange: FakeExchange | null = (this.bot?.exchange as FakeExchange) ?? null;
    if (!fakeExchange) {
      throw new Error('BackTester: Bot exchange is not a FakeExchange, cannot enable slow motion.');
    }
    fakeExchange.slowMotion(factor);
  }

  public async disableSlowMotion() {
    this.slowMotionFactor = 0;
    const fakeExchange: FakeExchange | null = (this.bot?.exchange as FakeExchange) ?? null;
    if (!fakeExchange) {
      throw new Error('BackTester: Bot exchange is not a FakeExchange, cannot enable slow motion.');
    }
    fakeExchange.slowMotion(0);
  }

  public async printReport(): Promise<void> {
    if (!this.bot) {
      throw new Error('BackTester: Bot has not been run yet.');
    }
    const condColor = (amount: number, value: any): string => {
      if (amount > 0) {
        return ansis.green(value);
      } else if (amount < 0) {
        return ansis.red(value);
      }
      return value;
    };

    const printPositionsTable = (positions: ALXPosition[]) => {
      console.table(
        positions.map((position) => {
          finalBalance += position.realizedPnl;
          const sideLeverage = `${position.side === ALXPositionSide.LONG ? 'L' : 'S'} @ ${position.leverage}x`;
          const pnl = position.realizedPnl;
          const mae = Math.min((position.minRealizedPnl ?? 0) / (position.margin || 1), 0) * 100;

          return {
            'Opened@': formatDateTimeFromMs(position.openTimestamp),
            '🏦': condColor(pnl, formatMoney(finalBalance, { colorize: false })),
            'Side@': condColor(pnl, sideLeverage),
            PNL: condColor(pnl, formatMoney(pnl)),
            maxPNL: condColor(pnl, formatMoney(position.maxRealizedPnl ?? 0)),
            minPNL: condColor(pnl, formatMoney(position.minRealizedPnl ?? 0)),
            MAE: condColor(mae, mae.toFixed(2) + '%'),
            duration: condColor(
              pnl,
              calcDurationMs(position.openTimestamp, position.closeTimestamp!)
            ),
          };
        })
      );
    };

    let finalBalance = this.initialBalance;
    const historicalPositions = this.bot.positionManager.getClosedPositions();
    printPositionsTable(historicalPositions);
    const runningPositions = this.bot.positionManager.getOpenPositions();
    if (runningPositions.length > 0) {
      console.log(ansis.yellow('⚠️  There are still open positions at the end of the backtest:'));
      printPositionsTable(runningPositions);
    }

    // Total pnl

    console.log(`
                                ┏┓┏┳┓┏┓┏┳┓┏┓
                                ┗┓ ┃ ┣┫ ┃ ┗┓
                                ┗┛ ┻ ┛┗ ┻ ┗┛
 ---------------------------------------------------------------------------
    `);

    const output = await this.generateOutput();

    const startTimestamp = output.klines[0]!.timestamp;
    const endTimestamp = output.klines[output.klines.length - 1]!.timestamp;

    const winRateColor = output.winRate >= 80 ? ansis.green : ansis.red;

    console.log(
      `Backtest Period: ${ansis.cyan(formatDateFromMs(startTimestamp))} - ${ansis.cyan(
        formatDateFromMs(endTimestamp)
      )}`
    );

    console.log(`Backtest Duration: ${ansis.cyan(calcDurationMs(startTimestamp, endTimestamp))}`);

    console.log(
      `P50 Position Duration: ${ansis.cyan(calcDurationMs(0, output.p50PositionDurationMs))}`
    );
    console.log(
      `Max Position Duration: ${ansis.cyan(calcDurationMs(0, output.maxPositionDurationMs))}`
    );
    console.log(`Potential Max Loss: ${ansis.red(formatMoney(output.potentialMaxLoss))}`);
    console.log(`Lowest Position PnL: ${ansis.red(formatMoney(output.lowerPositionPnl))}`);
    console.log(`Potential Max Profit: ${ansis.green(formatMoney(output.potentialMaxProfit))}`);
    console.log(`Max MAE: ${ansis.red(output.maxMAE.toFixed(2) + '%')}`);
    console.log(`P95 MAE: ${ansis.red(output.p95MAE.toFixed(2) + '%')}`);
    console.log(`Win Rate: ${winRateColor(output.winRate.toFixed(2) + '%')}`);
    console.log(`Sharpe Ratio: ${ansis.cyan(formatPerformanceMetric(output.sharpeRatio))}`);
    console.log(`Profit Factor: ${ansis.cyan(formatPerformanceMetric(output.profitFactor))}`);
    console.log(`Total PnL: ${ansis.green(formatMoney(output.pnl))}`);
    console.log(`P10 PnL: ${ansis.green(formatMoney(output.p10Pnl))}`);
    console.log(`Total Final Balance: ${ansis.green(formatMoney(output.finalBalance))}`);

    const printSideStats = (label: string, stats: BackTestSideStats) => {
      const sideWinRateColor = stats.winRate >= 50 ? ansis.green : ansis.red;
      const pnlValue = formatMoney(stats.pnl);
      const pnlColor =
        stats.pnl > 0 ? ansis.green : stats.pnl < 0 ? ansis.red : (value: string) => value;

      console.log(
        `${label}: ${ansis.cyan(stats.executed.toString())} executed (${stats.closed} closed / ${stats.open} open) | Win Rate: ${sideWinRateColor(
          stats.winRate.toFixed(2) + '%'
        )} | PnL: ${pnlColor(pnlValue)}`
      );
    };

    printSideStats('Longs', output.sideStats[ALXPositionSide.LONG]);
    printSideStats('Shorts', output.sideStats[ALXPositionSide.SHORT]);

    const sortStrategyStatsByUsage = (
      stats: BackTestStrategyStats[]
    ): BackTestStrategyStats[] => {
      return [...stats].sort((left, right) => {
        if (right.used !== left.used) {
          return right.used - left.used;
        }
        if (right.pnl !== left.pnl) {
          return right.pnl - left.pnl;
        }
        return left.strategyName.localeCompare(right.strategyName);
      });
    };

    const sortStrategyStatsByPnl = (
      stats: BackTestStrategyStats[],
      direction: 'asc' | 'desc'
    ): BackTestStrategyStats[] => {
      const directionMultiplier = direction === 'asc' ? 1 : -1;

      return [...stats].sort((left, right) => {
        if (right.pnl !== left.pnl) {
          return (left.pnl - right.pnl) * directionMultiplier;
        }
        if (right.used !== left.used) {
          return right.used - left.used;
        }
        return left.strategyName.localeCompare(right.strategyName);
      });
    };

    const formatPnlValue = (amount: number): string => {
      const value = formatMoney(amount, {
        colorize: false,
        withIcon: false,
      });

      if (amount > 0) {
        return ansis.green(value);
      }
      if (amount < 0) {
        return ansis.red(value);
      }
      return value;
    };

    const printStrategyStats = (title: string, stats: BackTestStrategyStats[]): void => {
      console.log(ansis.cyan.bold(`\n${title}`));

      if (stats.length === 0) {
        console.log(ansis.gray('No strategy data found.'));
        return;
      }

      console.table(
        stats.map((strategy) => {
          const strategyWinRateColor = strategy.winRate >= 50 ? ansis.green : ansis.red;

          return {
            Strategy: strategy.strategyName,
            Used: strategy.used,
            Closed: strategy.closed,
            Open: strategy.open,
            'Win Rate': strategyWinRateColor(strategy.winRate.toFixed(2) + '%'),
            'Avg PnL': formatPnlValue(strategy.averagePnl),
            'Total PnL': formatPnlValue(strategy.pnl),
          };
        })
      );
    };

    printStrategyStats(
      'Entry Strategies - Most Used',
      sortStrategyStatsByUsage(output.strategyStats.entryStrategies)
    );
    printStrategyStats(
      'Entry Strategies - Highest PnL',
      sortStrategyStatsByPnl(output.strategyStats.entryStrategies, 'desc')
    );
    printStrategyStats(
      'Exit Strategies - Most Used',
      sortStrategyStatsByUsage(output.strategyStats.exitStrategies)
    );
    printStrategyStats(
      'Exit Strategies - Highest PnL',
      sortStrategyStatsByPnl(output.strategyStats.exitStrategies, 'desc')
    );

    console.log('---------------------------------------------------------------------------');

    const reportGenerator = new ReportGenerator(output);
    reportGenerator.generate();

    const pnlCurveReportGenerator = new PnlCurveReportGenerator(output);
    pnlCurveReportGenerator.generate();
  }
}
