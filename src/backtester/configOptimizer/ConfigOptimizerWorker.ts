import { BackTester, type BackTestConfig } from '@/backtester/BackTester';
import {
  calculateProfitFactor,
  calculateSharpeRatio,
} from '@/backtester/performanceMetrics';
import { BotConfig, type SerializedBotConfig } from '@/siobot/BotConfig';
import type { ALXKline } from '@/domain/ALXKline';
import type { ALXPosition } from '@/domain/ALXPosition';
import { percentile } from '@/utils/percentile';
import type {
  EvaluationResult,
  WalkForwardWindow,
  WorkerRequest,
  WorkerResponse,
} from './types';

type EvaluateConfigParams = {
  serializedConfig: SerializedBotConfig;
  initialBalance: number;
  historicalKlines?: ALXKline[];
  defaultBotSerializedConfig?: SerializedBotConfig;
  walkForwardWindows?: WalkForwardWindow[];
  walkForwardMinTestTrades?: number;
};

type DetailedEvaluationResult = EvaluationResult & {
  positions: ALXPosition[];
};

const createEmptyResult = (
  config: SerializedBotConfig,
  runTimeMs: number = 0
): EvaluationResult => ({
  config,
  finalBalance: 0,
  pnl: 0,
  p10Pnl: 0,
  sharpeRatio: 0,
  profitFactor: 0,
  winRate: 0,
  lowerPositionPnl: 0,
  p50PositionDurationMs: 0,
  maxPositionDurationMs: 0,
  potentialMaxProfit: 0,
  potentialMaxLoss: 0,
  numPositions: 0,
  p95MAE: 0,
  walkForwardFoldCount: 0,
  walkForwardTrainPnl: 0,
  walkForwardTestPnl: 0,
  walkForwardPnlRetention: 0,
  walkForwardPositiveFoldRate: 0,
  walkForwardActiveFoldRate: 0,
  walkForwardTradeCount: 0,
  walkForwardMinFoldTrades: 0,
  walkForwardSufficientFoldRate: 0,
  runTimeMs,
});

const sum = (values: number[]): number => values.reduce((acc, value) => acc + value, 0);

const calculatePnlRetention = (trainPnl: number, testPnl: number): number => {
  if (trainPnl > 0) {
    return Math.max(0, Math.min(1, testPnl / trainPnl));
  }

  if (testPnl > 0) {
    return 1;
  }

  if (testPnl >= trainPnl) {
    return 0.5;
  }

  return 0;
};

const createEmptyDetailedResult = (
  config: SerializedBotConfig,
  runTimeMs: number = 0
): DetailedEvaluationResult => ({
  ...createEmptyResult(config, runTimeMs),
  positions: [],
});

const stripDetailedResult = (result: DetailedEvaluationResult): EvaluationResult => {
  const evaluation = { ...result };
  delete (evaluation as Partial<DetailedEvaluationResult>).positions;
  return evaluation;
};

const aggregateResults = (
  results: DetailedEvaluationResult[],
  originalConfig: SerializedBotConfig,
  initialBalance: number,
  extraMetrics?: Partial<EvaluationResult>,
  runTimeMsOverride?: number
): EvaluationResult => {
  if (results.length === 0) {
    return {
      ...createEmptyResult(originalConfig, runTimeMsOverride ?? 0),
      ...(extraMetrics ?? {}),
    };
  }

  const positions = results.flatMap((result) => result.positions);
  const closedPositions = positions.filter((position) => position.closeTimestamp !== undefined);
  const closedPositionPnls = closedPositions.map((position) => position.realizedPnl);
  const positionDurations = closedPositions.map(
    (position) => position.closeTimestamp! - position.openTimestamp
  );
  const MAEs = positions.map((position) => position.mae);
  const totalPnl = sum(results.map((result) => result.pnl));
  const totalPotentialMaxProfit = sum(results.map((result) => result.potentialMaxProfit));
  const totalPotentialMaxLoss = sum(results.map((result) => result.potentialMaxLoss));
  const lowerPositionPnl = positions.reduce(
    (lowest, position) => Math.min(lowest, position.minRealizedPnl ?? 0),
    0
  );
  const winCount = closedPositions.filter((position) => position.realizedPnl > 0).length;

  return {
    config: originalConfig,
    finalBalance: initialBalance + totalPnl,
    pnl: totalPnl,
    p10Pnl: closedPositionPnls.length > 0 ? percentile(closedPositionPnls, 0.1) : 0,
    sharpeRatio: calculateSharpeRatio(closedPositions),
    profitFactor: calculateProfitFactor(closedPositions),
    winRate: closedPositions.length > 0 ? (winCount / closedPositions.length) * 100 : 0,
    lowerPositionPnl,
    p50PositionDurationMs: positionDurations.length > 0 ? percentile(positionDurations, 0.5) : 0,
    maxPositionDurationMs: positionDurations.reduce(
      (maxDuration, duration) => Math.max(maxDuration, duration),
      0
    ),
    potentialMaxProfit: totalPotentialMaxProfit,
    potentialMaxLoss: totalPotentialMaxLoss,
    numPositions: positions.length,
    p95MAE: MAEs.length > 0 ? percentile(MAEs, 0.95) : 0,
    walkForwardFoldCount: extraMetrics?.walkForwardFoldCount ?? 0,
    walkForwardTrainPnl: extraMetrics?.walkForwardTrainPnl ?? 0,
    walkForwardTestPnl: extraMetrics?.walkForwardTestPnl ?? 0,
    walkForwardPnlRetention: extraMetrics?.walkForwardPnlRetention ?? 0,
    walkForwardPositiveFoldRate: extraMetrics?.walkForwardPositiveFoldRate ?? 0,
    walkForwardActiveFoldRate: extraMetrics?.walkForwardActiveFoldRate ?? 0,
    walkForwardTradeCount: extraMetrics?.walkForwardTradeCount ?? 0,
    walkForwardMinFoldTrades: extraMetrics?.walkForwardMinFoldTrades ?? 0,
    walkForwardSufficientFoldRate: extraMetrics?.walkForwardSufficientFoldRate ?? 0,
    runTimeMs: runTimeMsOverride ?? sum(results.map((result) => result.runTimeMs)),
  };
};

const runSingleBacktest = async (
  serializedConfig: SerializedBotConfig,
  initialBalance: number,
  historicalKlines?: ALXKline[],
  defaultBotSerializedConfig?: SerializedBotConfig
): Promise<DetailedEvaluationResult> => {
  const start = Date.now();
  const botConfig = new BotConfig({ defaultSerializedConfig: defaultBotSerializedConfig });
  botConfig.setSerializedConfig(serializedConfig);

  const backTestConfig: BackTestConfig = {
    initialBalance,
    botConfig: botConfig,
    historicalKlines,
    printReport: false,
  };

  const backTester = new BackTester(backTestConfig);
  let output = null;
  try {
    output = await backTester.run();
  } catch (error) {
    console.log('Error during backtest in ConfigOptimizerWorker:', error);
    return {
      ...createEmptyDetailedResult(serializedConfig, Date.now() - start),
      pnl: -initialBalance,
    };
  }

  // Sanity checks for extreme values that could cause NaN in fitness calculation
  const maxPositionDurationMs = Number.isFinite(output.maxPositionDurationMs)
    ? output.maxPositionDurationMs
    : 0;
  const p50PositionDurationMs = Number.isFinite(output.p50PositionDurationMs)
    ? output.p50PositionDurationMs
    : 0;

  return {
    ...createEmptyDetailedResult(serializedConfig, Date.now() - start),
    finalBalance: output.finalBalance,
    pnl: output.pnl,
    p10Pnl: output.p10Pnl,
    sharpeRatio: output.sharpeRatio,
    profitFactor: output.profitFactor,
    winRate: output.winRate,
    lowerPositionPnl: output.lowerPositionPnl,
    p50PositionDurationMs,
    maxPositionDurationMs,
    potentialMaxProfit: output.potentialMaxProfit,
    potentialMaxLoss: output.potentialMaxLoss,
    numPositions: output.positions.length,
    p95MAE: output.p95MAE,
    positions: output.positions,
  };
};

const evaluateConfig = async ({
  serializedConfig,
  initialBalance,
  historicalKlines,
  defaultBotSerializedConfig,
  walkForwardWindows,
  walkForwardMinTestTrades,
}: EvaluateConfigParams): Promise<EvaluationResult> => {
  if (!walkForwardWindows || walkForwardWindows.length === 0) {
    const directResult = await runSingleBacktest(
      serializedConfig,
      initialBalance,
      historicalKlines,
      defaultBotSerializedConfig
    );
    return stripDetailedResult(directResult);
  }

  const trainResults: DetailedEvaluationResult[] = [];
  const testResults: DetailedEvaluationResult[] = [];

  for (const fold of walkForwardWindows) {
    const trainConfig: SerializedBotConfig = {
      ...serializedConfig,
      backtestStartTimestampMs: fold.trainStart,
      backtestEndTimestampMs: fold.trainEnd,
    };
    trainResults.push(
      await runSingleBacktest(
        trainConfig,
        initialBalance,
        historicalKlines,
        defaultBotSerializedConfig
      )
    );

    const testConfig: SerializedBotConfig = {
      ...serializedConfig,
      backtestStartTimestampMs: fold.testStart,
      backtestEndTimestampMs: fold.testEnd,
    };
    testResults.push(
      await runSingleBacktest(
        testConfig,
        initialBalance,
        historicalKlines,
        defaultBotSerializedConfig
      )
    );
  }

  const totalTrainPnl = sum(trainResults.map((result) => result.pnl));
  const totalTestPnl = sum(testResults.map((result) => result.pnl));
  const testTradeCounts = testResults.map((result) => result.numPositions);
  const minRequiredTrades = Math.max(0, walkForwardMinTestTrades ?? 0);
  const walkForwardMetrics: Partial<EvaluationResult> = {
    walkForwardFoldCount: walkForwardWindows.length,
    walkForwardTrainPnl: totalTrainPnl,
    walkForwardTestPnl: totalTestPnl,
    walkForwardPnlRetention: calculatePnlRetention(totalTrainPnl, totalTestPnl),
    walkForwardPositiveFoldRate:
      testResults.filter((result) => result.pnl > 0).length / walkForwardWindows.length,
    walkForwardActiveFoldRate:
      testResults.filter((result) => result.numPositions > 0).length / walkForwardWindows.length,
    walkForwardTradeCount: sum(testTradeCounts),
    walkForwardMinFoldTrades: testTradeCounts.length > 0 ? Math.min(...testTradeCounts) : 0,
    walkForwardSufficientFoldRate:
      minRequiredTrades > 0
        ? testTradeCounts.filter((tradeCount) => tradeCount >= minRequiredTrades).length /
          walkForwardWindows.length
        : 1,
  };

  return aggregateResults(
    testResults,
    serializedConfig,
    initialBalance,
    walkForwardMetrics,
    sum([...trainResults, ...testResults].map((result) => result.runTimeMs))
  );
};

const ctx = globalThis as unknown as {
  postMessage: (data: WorkerResponse) => void;
  onmessage: ((event: { data: WorkerRequest }) => void) | null;
  close: () => void;
};
let cachedHistoricalKlines: ALXKline[] | undefined;

ctx.onmessage = async (event) => {
  try {
    const message = event.data;

    if (message.type === 'shutdown') {
      try {
        ctx.close();
      } catch {
        // Ignore close errors
      }
      return;
    }

    if (message.type !== 'run') {
      return;
    }

    try {
      if (message.historicalKlines) {
        cachedHistoricalKlines = message.historicalKlines;
      }

      const result = await evaluateConfig({
        serializedConfig: message.config,
        initialBalance: message.initialBalance,
        historicalKlines: cachedHistoricalKlines,
        defaultBotSerializedConfig: message.defaultBotSerializedConfig,
        walkForwardWindows: message.walkForwardWindows,
        walkForwardMinTestTrades: message.walkForwardMinTestTrades,
      });
      const response: WorkerResponse = { type: 'result', result };
      ctx.postMessage(response);
    } catch (error) {
      const response: WorkerResponse = {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error while evaluating config',
      };
      try {
        ctx.postMessage(response);
      } catch {
        // Cannot send error back, worker might be terminating
      }
    }
  } catch (outerError) {
    // Prevent any uncaught exceptions from causing SIGTRAP
    try {
      const response: WorkerResponse = {
        type: 'error',
        error: outerError instanceof Error ? outerError.message : 'Critical worker error',
      };
      ctx.postMessage(response);
    } catch {
      // Last resort: silently fail
    }
  }
};
