import fs from 'fs';
import path from 'path';
import { formatDurationMs, parseDateToMs } from '@/utils/date';
import { formatMoney } from '@/utils/money';
import {
  BotConfig,
  type ConfigOptimizerMetricBoundaries,
  type SerializedBotConfig,
} from '@/siobot/BotConfig';
import {
  OrderedBuffer,
  OrderedBufferEvictionSide,
  OrderedBufferSortDirection,
} from '@/utils/OrderedBuffer';
import { consoleLogger as logger, silentLogger } from '@/utils/logger';
import type { ALXKline } from '@/domain/ALXKline';
import ansis from 'ansis';
import os from 'os';
import { ConfigPermutator } from './ConfigPermutator';
import { GeneticAlgorithm } from './GeneticAlgorithm';
import { ConfigOptimizerReport } from './ConfigOptimizerReport';
import { ConfigOptimizerStabilityHeatmap } from './ConfigOptimizerStabilityHeatmap';
import type { EvaluationResult, WorkerResponse, OptimizerMode, WalkForwardWindow } from './types';
import { config } from '@/config';
import { ensureFolderInPath } from '@/utils/folders';
import { type ALXTimeFrame } from '@/domain/ALXTimeFrame';
import { getKlinesHistoryRange } from '@/utils/getKlinesHistory';
import { formatPerformanceMetric } from '@/backtester/performanceMetrics';

export type FitnessWeights = {
  pnl: number;
  p10Pnl: number;
  sharpeRatio: number;
  profitFactor: number;
  winRate: number;
  numPositions: number;
  p50PositionDurationMs: number;
  maxPositionDurationMs: number;
  lowerPositionPnl: number;
  potentialMaxLoss: number;
  p95MAE: number;
};

type MetricBounds = ConfigOptimizerMetricBoundaries;

type EvaluateAllParams = {
  configs: BotConfig[];
  discoveryMode: boolean;
  progress?: { total: number; processedOffset: number };
  silent?: boolean;
};

// This constant defines how many top results to display in the final ranking and how big
// the buffers will be to track best results during optimization.
const NUM_SNAPSHOTS_TO_SAVE = 10;
const PROGRESS_SHOW_TOP_AMOUNT = 10;
// Number of random samples to run in boundary discovery phase
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WALK_FORWARD_MIN_TEST_TRADES = 30;

type ResolvedWalkForwardSettings = {
  mode: 'rolling';
  trainWindowMs: number;
  testWindowMs: number;
  stepWindowMs: number;
  embargoMs: number;
  minTestTrades: number;
  trainWindowDays: number;
  testWindowDays: number;
  stepWindowDays: number;
  embargoDays: number;
};

export class ConfigOptimizer {
  private readonly initialBalance: number;
  private readonly maxWorkers: number;
  private readonly mode: OptimizerMode;

  private readonly bestPnl = new OrderedBuffer<EvaluationResult, number>({
    size: PROGRESS_SHOW_TOP_AMOUNT,
    direction: OrderedBufferSortDirection.Descending,
    uniqueEntries: false,
    evictionSide: OrderedBufferEvictionSide.LastItem,
  });

  private readonly bestFitness = new OrderedBuffer<EvaluationResult, number>({
    size: PROGRESS_SHOW_TOP_AMOUNT,
    direction: OrderedBufferSortDirection.Descending,
    uniqueEntries: false,
    evictionSide: OrderedBufferEvictionSide.LastItem,
  });

  private results: EvaluationResult[] = [];
  private historicalKlines?: ALXKline[];
  private currentGeneration: number = 0;
  private totalEvaluations: number = 0;
  private outputReport: string = '';
  private botConfig: BotConfig;
  private hotkeyCleanup?: () => void;
  private silent: boolean = false;
  private logger: typeof logger = logger;
  private startTimestampMs: number = 0;
  private endTimestampMs: number = 0;
  private runFast: boolean = false;
  private reportEnabled: boolean = true;
  private walkForwardFolds: number = 0; // 0 means disabled
  private cumulativeProgressStartTimeMs: number | null = null;
  private localProgressStartTimeMs: number | null = null;
  private lastLocalProgressCount: number = 0;
  private lastPreviewRows: number = 0;

  private bounds: MetricBounds | null = null;
  private evaluationHistory: EvaluationResult[] = [];
  private discoveryHistory: EvaluationResult[] = [];

  private readonly walkForwardSettings: ResolvedWalkForwardSettings;

  // Walk-forward folds for multi-window out-of-sample evaluation (generated once)
  private readonly walkForwardWindows: WalkForwardWindow[];

  // Report instance for tracking fitness distribution
  private readonly report = new ConfigOptimizerReport();
  private readonly evaluationCache = new Map<string, EvaluationResult>();

  constructor(params: {
    initialBalance?: number;
    maxWorkers?: number;
    mode?: OptimizerMode;
    botConfig: BotConfig;
    silent?: boolean;
    runFast?: boolean;
    startTimestampMs: number;
    endTimestampMs: number;
    reportEnabled?: boolean;
    walkForwardFolds: number;
  }) {
    this.silent = params?.silent ?? false;
    this.runFast = params?.runFast ?? false;
    this.reportEnabled = params?.reportEnabled ?? true;
    this.startTimestampMs = params?.startTimestampMs ?? parseDateToMs(config.backTest.startDate);
    this.endTimestampMs = params?.endTimestampMs ?? parseDateToMs(config.backTest.endDate);
    this.initialBalance = params?.initialBalance ?? config.backTest.initialBalance;
    this.walkForwardFolds = params?.walkForwardFolds ?? 0; // 0 means disabled

    if (this.silent) {
      this.logger = silentLogger;
    }
    this.initializeBounds();
    this.mode = params?.mode ?? 'genetic';
    const cpuCount = os.cpus().length;
    const desiredWorkers = params?.maxWorkers ?? cpuCount;
    this.maxWorkers = Math.max(1, desiredWorkers);
    this.botConfig = params.botConfig;

    // Generate walk-forward folds once during construction
    this.walkForwardSettings = this.resolveWalkForwardSettings();
    this.walkForwardWindows = this.generateWalkForwardWindows();
  }

  private getEvaluationCacheScope(discoveryMode: boolean): string {
    if (discoveryMode || this.walkForwardWindows.length === 0) {
      return 'direct';
    }

    const folds = this.walkForwardWindows
      .map(
        (window) =>
          `${window.trainStart}:${window.trainEnd}:${window.embargoStart ?? 'na'}:${window.embargoEnd ?? 'na'}:${window.testStart}:${window.testEnd}`
      )
      .join('|');
    return `wfo:${folds}`;
  }

  private getConfigHash(config: SerializedBotConfig): string {
    return Object.keys(config)
      .sort()
      .map((key) => {
        const value = (config as Record<string, unknown>)[key];
        const serializedValue = this.stableSerialize(value);
        return `${key}:${serializedValue}`;
      })
      .join('|');
  }

  private stableSerialize(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return String(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableSerialize(entry)).join(',')}]`;
    }

    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const nestedValue = (value as Record<string, unknown>)[key];
        return `${key}:${this.stableSerialize(nestedValue)}`;
      })
      .join(',')}}`;
  }

  private formatResultHashNumber(value: number | undefined, decimals?: number): string {
    if (value === undefined) {
      return 'undefined';
    }

    if (!Number.isFinite(value)) {
      return String(value);
    }

    const normalized = decimals === undefined ? value : Number(value.toFixed(decimals));
    const positiveZero = Object.is(normalized, -0) ? 0 : normalized;
    return decimals === undefined ? positiveZero.toString() : positiveZero.toFixed(decimals);
  }

  private getRankingResultHash(result: EvaluationResult): string {
    return [
      `fitness:${this.formatResultHashNumber(result.fitness ?? 0, 3)}`,
      `finalBalance:${this.formatResultHashNumber(result.finalBalance, 2)}`,
      `pnl:${this.formatResultHashNumber(result.pnl, 2)}`,
      `p10Pnl:${this.formatResultHashNumber(result.p10Pnl, 2)}`,
      `sharpeRatio:${this.formatResultHashNumber(result.sharpeRatio, 2)}`,
      `profitFactor:${this.formatResultHashNumber(result.profitFactor, 2)}`,
      `winRate:${this.formatResultHashNumber(result.winRate, 2)}`,
      `lowerPositionPnl:${this.formatResultHashNumber(result.lowerPositionPnl, 2)}`,
      `p50PositionDurationMs:${formatDurationMs(result.p50PositionDurationMs)}`,
      `maxPositionDurationMs:${formatDurationMs(result.maxPositionDurationMs)}`,
      `potentialMaxProfit:${this.formatResultHashNumber(result.potentialMaxProfit, 2)}`,
      `potentialMaxLoss:${this.formatResultHashNumber(result.potentialMaxLoss, 2)}`,
      `numPositions:${Math.round(result.numPositions)}`,
      `p95MAE:${this.formatResultHashNumber(result.p95MAE, 2)}`,
      `walkForwardFoldCount:${Math.round(result.walkForwardFoldCount)}`,
      `walkForwardTrainPnl:${this.formatResultHashNumber(result.walkForwardTrainPnl, 2)}`,
      `walkForwardTestPnl:${this.formatResultHashNumber(result.walkForwardTestPnl, 2)}`,
      `walkForwardPnlRetention:${this.formatResultHashNumber(
        result.walkForwardPnlRetention,
        4
      )}`,
      `walkForwardPositiveFoldRate:${this.formatResultHashNumber(
        result.walkForwardPositiveFoldRate,
        4
      )}`,
      `walkForwardActiveFoldRate:${this.formatResultHashNumber(
        result.walkForwardActiveFoldRate,
        4
      )}`,
      `walkForwardTradeCount:${Math.round(result.walkForwardTradeCount)}`,
      `walkForwardMinFoldTrades:${Math.round(result.walkForwardMinFoldTrades)}`,
      `walkForwardSufficientFoldRate:${this.formatResultHashNumber(
        result.walkForwardSufficientFoldRate,
        4
      )}`,
    ].join('|');
  }

  private rankingContainsResult(buffer: EvaluationResult[], result: EvaluationResult): boolean {
    const configHash = this.getConfigHash(result.config);
    const resultHash = this.getRankingResultHash(result);

    return buffer.some(
      (ranked) =>
        this.getConfigHash(ranked.config) === configHash ||
        this.getRankingResultHash(ranked) === resultHash
    );
  }

  private getEvaluationCacheKey(config: SerializedBotConfig, discoveryMode: boolean): string {
    return `${this.getEvaluationCacheScope(discoveryMode)}|${this.getConfigHash(config)}`;
  }

  private cloneSerializedConfig(config: SerializedBotConfig): SerializedBotConfig {
    const clone: SerializedBotConfig = {};

    for (const [key, value] of Object.entries(config)) {
      (clone as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
    }

    return clone;
  }

  private cloneEvaluationResult(result: EvaluationResult): EvaluationResult {
    return {
      ...result,
      config: this.cloneSerializedConfig(result.config),
    };
  }

  private getHistoricalTimeframes(): ALXTimeFrame[] {
    const timeframes = new Set<ALXTimeFrame>([
      ...this.botConfig.timeFramesFromNexus,
      this.botConfig.timeFrameToTrade as ALXTimeFrame,
      this.botConfig.timeFrameToDetectRegime as ALXTimeFrame,
    ]);

    if (this.botConfig.microTrendRetestBreakEnterStrategy_Enabled.value) {
      timeframes.add('5m');
    }

    return Array.from(timeframes);
  }

  private processEvaluationResult(
    evaluation: EvaluationResult,
    configs: BotConfig[],
    discoveryMode: boolean,
    progress?: { total: number; processedOffset: number },
    silent: boolean = false
  ): void {
    this.results.push(evaluation);

    if (discoveryMode) {
      this.updateBounds(evaluation);
      this.discoveryHistory.push(evaluation);
    }

    if (!discoveryMode) {
      evaluation.fitness = this.calculateFitness(evaluation);
      this.recordCompletedEvaluation(evaluation);
      this.updateRanking(evaluation);
    }

    if (!this.silent && !silent) {
      this.printProgress(configs, discoveryMode, progress);
    }
  }

  private getFitnessWeight(weights: Partial<FitnessWeights>, key: keyof FitnessWeights): number {
    const weight = weights[key];
    return typeof weight === 'number' && Number.isFinite(weight) ? weight : 0;
  }

  private initializeBounds(): void {
    this.results = [];
    this.evaluationHistory = [];
    this.discoveryHistory = [];
    this.totalEvaluations = 0;
    this.currentGeneration = 0;
    this.outputReport = '';
    this.cumulativeProgressStartTimeMs = null;
    this.localProgressStartTimeMs = null;
    this.lastLocalProgressCount = 0;
    this.lastPreviewRows = 0;
    this.bestPnl.clear();
    this.bestFitness.clear();
    if (this.reportEnabled) {
      this.report.reset();
    }
    this.bounds = {
      pnl: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
      p10Pnl: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
      winRate: { min: 0, max: 100 },
      numPositions: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
      p50PositionDurationMs: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
      lowerPositionPnl: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
      potentialMaxLoss: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
      maxPositionDurationMs: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
      p95MAE: { min: 0, max: 100 },
    };
  }

  private generateWalkForwardWindows(): WalkForwardWindow[] {
    if (this.walkForwardFolds <= 0) {
      return [];
    }

    if (this.endTimestampMs <= this.startTimestampMs) {
      return [];
    }

    const windows: WalkForwardWindow[] = [];
    let testEnd = this.endTimestampMs;

    while (windows.length < this.walkForwardFolds) {
      const testStart = testEnd - this.walkForwardSettings.testWindowMs + 1;
      if (testStart < this.startTimestampMs) {
        break;
      }

      const embargoEnd = testStart - 1;
      const trainEnd = embargoEnd - this.walkForwardSettings.embargoMs;
      if (trainEnd < this.startTimestampMs) {
        break;
      }

      const trainStart =
        this.walkForwardSettings.mode === 'rolling'
          ? trainEnd - this.walkForwardSettings.trainWindowMs + 1
          : this.startTimestampMs;

      if (trainStart < this.startTimestampMs) {
        if (this.walkForwardSettings.mode === 'rolling') {
          break;
        }
      }

      const resolvedTrainStart =
        this.walkForwardSettings.mode === 'rolling' ? trainStart : this.startTimestampMs;

      const embargoStart = this.walkForwardSettings.embargoMs > 0 ? trainEnd + 1 : null;
      const resolvedEmbargoEnd = this.walkForwardSettings.embargoMs > 0 ? embargoEnd : null;

      windows.unshift({
        trainStart: resolvedTrainStart,
        trainEnd,
        embargoStart,
        embargoEnd: resolvedEmbargoEnd,
        testStart,
        testEnd,
      });

      testEnd -= this.walkForwardSettings.stepWindowMs;
    }

    return windows;
  }

  private resolveWalkForwardSettings(): ResolvedWalkForwardSettings {
    const totalSpanMs = this.endTimestampMs - this.startTimestampMs + 1;
    const foldCount = Math.max(1, this.walkForwardFolds);
    const totalSpanDays = Math.max(1, Math.floor(totalSpanMs / DAY_IN_MS));
    const initialTestWindowDays = Math.max(1, Math.floor(totalSpanDays / (foldCount + 2)));
    const embargoDays = Math.max(1, Math.min(3, Math.round(initialTestWindowDays * 0.05)));
    const usableSpanDays = Math.max(1, totalSpanDays - embargoDays);
    const testWindowDays = Math.max(1, Math.floor(usableSpanDays / (foldCount + 2)));
    const stepWindowDays = testWindowDays;
    const trainWindowDays = Math.max(testWindowDays, usableSpanDays - foldCount * testWindowDays);

    return {
      mode: 'rolling',
      trainWindowMs: Math.max(1, Math.floor(trainWindowDays * DAY_IN_MS)),
      testWindowMs: Math.max(1, Math.floor(testWindowDays * DAY_IN_MS)),
      stepWindowMs: Math.max(1, Math.floor(stepWindowDays * DAY_IN_MS)),
      embargoMs: Math.max(0, Math.floor(embargoDays * DAY_IN_MS)),
      minTestTrades: DEFAULT_WALK_FORWARD_MIN_TEST_TRADES,
      trainWindowDays,
      testWindowDays,
      stepWindowDays,
      embargoDays,
    };
  }

  private setupSaveHotkey(): void {
    const stdin = process.stdin;
    if (!stdin?.isTTY) {
      return;
    }

    this.teardownSaveHotkey();

    const wasRaw = stdin.isRaw;
    const wasPaused = stdin.isPaused();

    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }

    if (wasPaused) {
      stdin.resume();
    }

    const onData = (data: Buffer) => {
      const input = data.toString();

      if (input === '\u0003') {
        this.teardownSaveHotkey();
        process.kill(process.pid, 'SIGINT');
        return;
      }

      if (input.toLowerCase() === 's') {
        this.saveSnapshotFiles();
      }
    };

    stdin.on('data', onData);

    this.hotkeyCleanup = () => {
      stdin.off('data', onData);
      if (stdin.setRawMode) {
        stdin.setRawMode(Boolean(wasRaw));
      }
      if (wasPaused) {
        stdin.pause();
      }
    };
  }

  private teardownSaveHotkey(): void {
    if (!this.hotkeyCleanup) {
      return;
    }
    this.hotkeyCleanup();
    this.hotkeyCleanup = undefined;
  }

  public async runAndGetBestResult(): Promise<{
    bestFitnessResult: EvaluationResult | null;
  } | null> {
    this.initializeBounds();
    console.log(
      'Running config optimizer (Start Date: ',
      new Date(this.startTimestampMs).toISOString(),
      ' End Date: ',
      new Date(this.endTimestampMs).toISOString(),
      ')...'
    );
    console.log(this.getWalkForwardSummary());
    if (this.mode === 'genetic') {
      await this.runGeneticAlgorithm();
    }

    if (this.mode === 'bruteforce') {
      await this.runBruteForce();
    }

    return {
      bestFitnessResult: this.bestFitness.getFirst() ?? null,
    };
  }

  public async run(): Promise<void> {
    let didRun = false;
    this.initializeBounds();
    this.logger.info(
      `Running config optimizer (Start Date: ${new Date(this.startTimestampMs).toISOString()} End Date: ${new Date(this.endTimestampMs).toISOString()})...`
    );
    this.setupSaveHotkey();
    this.logger.info(this.getWalkForwardSummary());
    if (this.walkForwardFolds > 0 && this.walkForwardWindows.length < this.walkForwardFolds) {
      this.logger.warn(
        `Walk-forward configuration requested ${this.walkForwardFolds} folds, but only ${this.walkForwardWindows.length} fit inside the selected date range.`
      );
    }
    this.walkForwardWindows.forEach((window, idx) => {
      const embargoInfo =
        window.embargoStart === null || window.embargoEnd === null
          ? ''
          : ` | embargo ${new Date(window.embargoStart).toISOString()} -> ${new Date(window.embargoEnd).toISOString()}`;
      this.logger.info(
        `  Fold ${idx + 1}: train ${new Date(window.trainStart).toISOString()} -> ${new Date(window.trainEnd).toISOString()}${embargoInfo} | test ${new Date(window.testStart).toISOString()} -> ${new Date(window.testEnd).toISOString()}`
      );
    });
    try {
      if (this.mode === 'genetic') {
        didRun = true;
        await this.runGeneticAlgorithm();
      }

      if (this.mode === 'bruteforce') {
        didRun = true;
        await this.runBruteForce();
      }

      if (didRun) {
        this.saveSnapshotFiles();
        this.saveReport();
        this.saveParameterStabilityHeatmap();
      }
    } finally {
      this.teardownSaveHotkey();
    }
  }

  private async runBruteForce(): Promise<void> {
    const configPermutator = new ConfigPermutator(this.botConfig);
    const totalConfigs = configPermutator.estimateTotalConfigurations();
    this.logger.info(
      `Generated ~${totalConfigs} configurations for brute-force optimization (streaming, not precomputed).`
    );

    if (totalConfigs === 0) {
      this.logger.warn('ConfigOptimizer: no configurations to evaluate.');
      return;
    }

    this.historicalKlines = await this.getHistoricalKlines();

    if (this.maxWorkers > 1) {
      const workerCount = this.maxWorkers;
      this.logger.info(`ConfigOptimizer: using ${workerCount} worker threads.`);
    }

    const start = Date.now();
    const iterator = configPermutator.iterateConfigurations();
    const batchSize = Math.max(200, this.maxWorkers * 4);
    let processed = 0;

    while (true) {
      const batch: BotConfig[] = [];
      for (let i = 0; i < batchSize; i++) {
        const next = iterator.next();
        if (next.done) {
          break;
        }
        batch.push(next.value);
      }

      if (batch.length === 0) {
        break;
      }

      // Avoid unbounded growth of this.results when streaming
      this.results = [];
      this.addBacktestTimestampsToConfigs(batch, this.startTimestampMs, this.endTimestampMs);
      await this.evaluateAll({
        configs: batch,
        discoveryMode: false,
        progress: {
          total: totalConfigs,
          processedOffset: processed,
        },
      });
      processed += batch.length;
    }
    const durationSec = ((Date.now() - start) / 1000).toFixed(2);
    this.logger.info('\n');
    this.logger.info(
      `ConfigOptimizer: completed evaluation of ${totalConfigs} configs in ${durationSec}s`
    );
  }

  private async runGeneticAlgorithm(): Promise<void> {
    const geneticAlgorithm = new GeneticAlgorithm({
      botConfig: this.botConfig,
      populationSize: this.runFast
        ? 50
        : this.botConfig.configOptimizerGenetic?.params.populationSize,
      generations: this.runFast ? 2 : this.botConfig.configOptimizerGenetic?.params.generations,
      eliteCount: this.runFast ? 3 : this.botConfig.configOptimizerGenetic?.params.eliteCount,
      mutationRate: this.botConfig.configOptimizerGenetic?.params.mutationRate,
      crossoverRate: this.botConfig.configOptimizerGenetic?.params.crossoverRate,
      tournamentSize: this.botConfig.configOptimizerGenetic?.params.tournamentSize,
      convergenceLimit: this.runFast
        ? 8
        : this.botConfig.configOptimizerGenetic?.params.convergenceLimit,
      diversityThreshold: this.botConfig.configOptimizerGenetic?.params.diversityThreshold,
      adaptiveMutation: this.botConfig.configOptimizerGenetic?.params.adaptiveMutation,
      crossoverType: this.botConfig.configOptimizerGenetic?.params.crossoverType,
      mutationStrength: this.botConfig.configOptimizerGenetic?.params.mutationStrength,
    });
    const gaParams = geneticAlgorithm.getParams();
    this.logger.info(
      `Starting Genetic Algorithm optimization with ${gaParams.populationSize} individuals for ${gaParams.generations} generations.`
    );
    this.logger.info(
      `GA Parameters: Elite=${gaParams.eliteCount}, MutationRate=${gaParams.mutationRate}, CrossoverRate=${gaParams.crossoverRate}, TournamentSize=${gaParams.tournamentSize}, ConvergenceLimit=${gaParams.convergenceLimit}`
    );

    this.historicalKlines = await this.getHistoricalKlines();

    if (this.maxWorkers > 1) {
      const workerCount = Math.min(this.maxWorkers, gaParams.populationSize);
      this.logger.info(`ConfigOptimizer: using ${workerCount} worker threads.`);
      this.logger.info(
        ansis.bgMagenta(`Press [S] key to save current top configuration snapshots at any time...`)
      );
    }

    const start = Date.now();

    // ========== PHASE 1: Boundary Discovery ==========
    const boundaryDiscoverySamples =
      this.botConfig.configOptimizerGenetic?.params.boundaryDiscoverySamples;
    this.logger.info(`\n${ansis.bold.yellow('=== PHASE 1: Boundary Discovery ===')}`);

    if (boundaryDiscoverySamples > 0) {
      this.logger.info(
        `Running ${Math.min(
          gaParams.searchSpaceSize ?? boundaryDiscoverySamples,
          boundaryDiscoverySamples
        )} random samples to detect metric boundaries...`
      );

      const discoveryPopulation = geneticAlgorithm.generateRandomPopulation(
        Math.min(gaParams.searchSpaceSize ?? boundaryDiscoverySamples, boundaryDiscoverySamples)
      );

      await this.evaluatePopulationForDiscovery(discoveryPopulation);

      this.logBoundarySummary();
      this.finalizeDiscoveryHistory();
    } else {
      this.applyFixedBoundaries();
      this.logger.info(
        'Boundary discovery disabled because boundaryDiscoverySamples is 0. Using configOptimizerGenetic.boundaries.'
      );
      this.logBoundarySummary('Fixed boundaries loaded:');
    }

    // ========== PHASE 2: Genetic Algorithm Evolution ==========
    this.logger.info(`\n${ansis.bold.yellow('=== PHASE 2: Genetic Algorithm Evolution ===')}`);

    // Generate initial population for evolution
    const discoverySeeds = [...this.results]
      .sort((left, right) => {
        const leftScore = Number.isFinite(left.fitness) ? (left.fitness ?? 0) : left.pnl;
        const rightScore = Number.isFinite(right.fitness) ? (right.fitness ?? 0) : right.pnl;
        return rightScore - leftScore;
      })
      .map((result) => result.config);
    let population = geneticAlgorithm.generateInitialPopulation(discoverySeeds);
    this.logger.info(`Generated initial population of ${population.length} individuals.`);

    // Convergence tracking
    let bestFitnessEver = Number.NEGATIVE_INFINITY;
    let generationsWithoutImprovement = 0;

    // Evolution loop
    for (let gen = 0; gen < gaParams.generations; gen++) {
      this.currentGeneration = gen + 1;
      this.results = []; // Clear results for this generation

      // Evaluate current population
      const evaluations = await this.evaluatePopulation(population);

      // Check for convergence
      const currentBestFitness = Math.max(...evaluations.map((e) => e.fitness ?? 0));

      if (currentBestFitness > bestFitnessEver) {
        bestFitnessEver = currentBestFitness;
        generationsWithoutImprovement = 0;
      } else {
        generationsWithoutImprovement++;
      }

      // Stop early if no improvement for convergenceLimit generations
      if (generationsWithoutImprovement >= gaParams.convergenceLimit) {
        this.logger.info(
          `\n${ansis.bold.yellow(`Convergence reached: No improvement for ${gaParams.convergenceLimit} generations. Stopping early at generation ${this.currentGeneration}.`)}`
        );
        break;
      }

      // Evolve to next generation (unless this is the last generation)
      if (gen < gaParams.generations - 1) {
        population = geneticAlgorithm.evolve(evaluations);
      }
    }

    const durationSec = ((Date.now() - start) / 1000).toFixed(2);
    this.logger.info(
      `\nConfigOptimizer: completed ${this.totalEvaluations} evaluations in ${durationSec}s`
    );
  }

  private async evaluatePopulationForDiscovery(configs: BotConfig[]): Promise<void> {
    this.addBacktestTimestampsToConfigs(configs, this.startTimestampMs, this.endTimestampMs);
    // Evaluate without updating rankings (boundaries are not set yet)
    await this.evaluateAll({
      configs,
      discoveryMode: true,
    });
  }

  private async evaluatePopulation(configs: BotConfig[]): Promise<EvaluationResult[]> {
    this.addBacktestTimestampsToConfigs(configs, this.startTimestampMs, this.endTimestampMs);
    await this.evaluateAll({
      configs,
      discoveryMode: false,
    });
    return this.results;
  }

  private addBacktestTimestampsToConfigs(
    configs: BotConfig[],
    startTimestampMs: number,
    endTimestampMs: number
  ): void {
    for (const config of configs) {
      config.backtestStartTimestampMs = startTimestampMs;
      config.backtestEndTimestampMs = endTimestampMs;
    }
  }

  private async evaluateAll({
    configs,
    discoveryMode = false,
    progress,
    silent = false,
  }: EvaluateAllParams): Promise<void> {
    this.results = [];
    const directEvaluations: EvaluationResult[] = [];
    const pendingJobs: SerializedBotConfig[] = [];

    for (const config of configs) {
      const serialized = config.getSerializedConfig();
      const cacheKey = this.getEvaluationCacheKey(serialized, discoveryMode);
      const cachedEvaluation = this.evaluationCache.get(cacheKey);

      if (cachedEvaluation) {
        directEvaluations.push(this.cloneEvaluationResult(cachedEvaluation));
        continue;
      }

      pendingJobs.push(serialized);
    }

    directEvaluations.forEach((evaluation) => {
      this.processEvaluationResult(evaluation, configs, discoveryMode, progress, silent);
    });

    if (pendingJobs.length === 0) {
      return;
    }

    const historicalKlines = await this.getHistoricalKlines();
    const workerCount = Math.min(this.maxWorkers, pendingJobs.length);
    const workerRelativePath = './backtester/configOptimizer/ConfigOptimizerWorker.ts';
    const workerUrl =
      process.env.SIOBOT_IS_BINARY === 'true'
        ? workerRelativePath
        : path.resolve(__dirname, './ConfigOptimizerWorker.ts');
    const jobQueue = [...pendingJobs];

    const spawnWorker = async (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        if (jobQueue.length === 0) {
          resolve();
          return;
        }

        const worker = new Worker(workerUrl, { type: 'module', name: 'config-optimizer' });

        let settled = false;
        let isTerminating = false;
        let workerHasHistoricalKlines = false;

        const settleError = (error: Error): void => {
          if (settled) {
            return;
          }
          settled = true;
          isTerminating = true;
          // Use setImmediate to allow current event loop to complete
          setImmediate(() => {
            try {
              worker.terminate();
            } catch {
              // ignore terminate errors
            }
          });
          reject(error);
        };

        const settleSuccess = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          isTerminating = true;
          // Use setImmediate to allow current event loop to complete
          setImmediate(() => {
            try {
              worker.terminate();
            } catch {
              // ignore terminate errors
            }
          });
          resolve();
        };

        const sendNext = (): boolean => {
          if (isTerminating || settled) {
            return false;
          }
          const job = jobQueue.shift();
          if (!job) {
            try {
              worker.postMessage({ type: 'shutdown' });
            } catch {
              // Worker might already be terminated, ignore
            }
            return false;
          }
          try {
            worker.postMessage({
              type: 'run',
              config: job,
              historicalKlines: workerHasHistoricalKlines ? undefined : historicalKlines,
              initialBalance: this.initialBalance,
              defaultBotSerializedConfig: this.botConfig.getSerializedConfig(),
              // Pass walk-forward folds for non-discovery evaluations
              walkForwardWindows: discoveryMode ? undefined : this.walkForwardWindows,
              walkForwardMinTestTrades: discoveryMode
                ? undefined
                : this.walkForwardSettings.minTestTrades,
            });
            workerHasHistoricalKlines = true;
          } catch (error) {
            settleError(error instanceof Error ? error : new Error(String(error)));
            return false;
          }
          return true;
        };

        worker.onmessage = (event) => {
          if (settled || isTerminating) {
            return;
          }

          const message = event.data as WorkerResponse;

          if (message.type === 'error') {
            settleError(new Error(message.error));
            return;
          }

          if (message.type !== 'result') {
            return;
          }

          try {
            const cacheKey = this.getEvaluationCacheKey(message.result.config, discoveryMode);
            const cachedResult = this.cloneEvaluationResult(message.result);
            this.evaluationCache.set(cacheKey, cachedResult);
            const evaluation = this.cloneEvaluationResult(cachedResult);
            this.processEvaluationResult(evaluation, configs, discoveryMode, progress, silent);

            if (!sendNext()) {
              settleSuccess();
            }
          } catch (error) {
            settleError(error instanceof Error ? error : new Error(String(error)));
          }
        };

        worker.onerror = (event: any) => {
          const error =
            event?.error instanceof Error
              ? event.error
              : new Error(event?.message ?? 'Unknown worker error');
          settleError(error);
        };

        worker.onmessageerror = (event: any) => {
          const error =
            event?.error instanceof Error
              ? event.error
              : new Error(event?.message ?? 'Worker message error');
          settleError(error);
        };

        if (!sendNext()) {
          settleSuccess();
        }
      });

    await Promise.all(Array.from({ length: workerCount }, () => spawnWorker()));
  }

  private async getHistoricalKlines(): Promise<ALXKline[]> {
    if (!this.historicalKlines) {
      this.historicalKlines = await getKlinesHistoryRange({
        startTimestampMs: this.startTimestampMs,
        endTimestampMs: this.endTimestampMs,
        symbol: this.botConfig.assetSymbol!,
        timeframes: this.getHistoricalTimeframes(),
        log: true,
      });
    }
    return this.historicalKlines;
  }

  private applyFixedBoundaries(): void {
    const fixedBoundaries = this.botConfig.configOptimizerGenetic?.boundaries;
    if (!fixedBoundaries) {
      throw new Error(
        'ConfigOptimizer: boundaryDiscoverySamples is 0, but configOptimizerGenetic.boundaries is not configured.'
      );
    }

    this.validateFixedBoundaries(fixedBoundaries);
    this.bounds = this.cloneMetricBounds(fixedBoundaries);
  }

  private validateFixedBoundaries(boundaries: MetricBounds): void {
    for (const [metric, boundary] of Object.entries(boundaries)) {
      if (
        !boundary ||
        !Number.isFinite(boundary.min) ||
        !Number.isFinite(boundary.max) ||
        boundary.min >= boundary.max
      ) {
        throw new Error(
          `ConfigOptimizer: invalid fixed boundary for ${metric}. Expected finite min < max.`
        );
      }
    }
  }

  private cloneMetricBounds(boundaries: MetricBounds): MetricBounds {
    return {
      pnl: { ...boundaries.pnl },
      p10Pnl: { ...boundaries.p10Pnl },
      winRate: { ...boundaries.winRate },
      numPositions: { ...boundaries.numPositions },
      p50PositionDurationMs: { ...boundaries.p50PositionDurationMs },
      lowerPositionPnl: { ...boundaries.lowerPositionPnl },
      potentialMaxLoss: { ...boundaries.potentialMaxLoss },
      maxPositionDurationMs: { ...boundaries.maxPositionDurationMs },
      p95MAE: { ...boundaries.p95MAE },
    };
  }

  private updateBounds(result: EvaluationResult): void {
    if (!this.bounds) {
      return;
    }

    // Helper to safely update bounds with finite values only
    const safeUpdateBounds = (
      bounds: { min: number; max: number },
      value: number,
      minMultiplier: number = 1,
      maxMultiplier: number = 1,
      minValueClamp?: number,
      maxValueClamp?: number
    ) => {
      if (!Number.isFinite(value)) {
        return;
      }
      const minValue = value >= 0 ? value * minMultiplier : value * maxMultiplier;
      const maxValue = value >= 0 ? value * maxMultiplier : value * minMultiplier;
      if (Number.isFinite(minValue)) {
        bounds.min = Math.min(bounds.min, minValue);
        if (minValueClamp) {
          bounds.min = this.clamp(bounds.min, minValueClamp, Number.POSITIVE_INFINITY);
        }
      }
      if (Number.isFinite(maxValue)) {
        bounds.max = Math.max(bounds.max, maxValue);
        if (maxValueClamp) {
          bounds.max = this.clamp(bounds.max, Number.NEGATIVE_INFINITY, maxValueClamp);
        }
      }
    };

    // Expand bounds by 50% around observed profit metrics so normalization stays stable.
    safeUpdateBounds(this.bounds.pnl, result.pnl, 0.5, 1.5);
    safeUpdateBounds(this.bounds.p10Pnl, result.p10Pnl, 0.5, 1.5);
    safeUpdateBounds(this.bounds.p50PositionDurationMs, result.p50PositionDurationMs);
    safeUpdateBounds(this.bounds.lowerPositionPnl, result.lowerPositionPnl);
    safeUpdateBounds(this.bounds.potentialMaxLoss, result.potentialMaxLoss);
    safeUpdateBounds(this.bounds.maxPositionDurationMs, result.maxPositionDurationMs);
    safeUpdateBounds(this.bounds.numPositions, result.numPositions);
    safeUpdateBounds(this.bounds.p95MAE, result.p95MAE);
  }

  private logBoundarySummary(title: string = 'Boundaries discovered:'): void {
    if (!this.bounds) {
      return;
    }
    this.logger.info(`\n${ansis.bold.green(title)}`);
    this.logger.info(
      `  PNL: [${formatMoney(this.bounds.pnl.min)} - ${formatMoney(this.bounds.pnl.max)}]`
    );
    this.logger.info(
      `  p10Pnl: [${formatMoney(this.bounds.p10Pnl.min)} - ${formatMoney(this.bounds.p10Pnl.max)}]`
    );
    this.logger.info(
      `  WinRate: [${this.bounds.winRate.min.toFixed(2)}% - ${this.bounds.winRate.max.toFixed(2)}%]`
    );
    this.logger.info(
      `  NumPositions: [${this.bounds.numPositions.min} - ${this.bounds.numPositions.max}]`
    );
    this.logger.info(
      `  P50PositionDurationMs: [${formatDurationMs(this.bounds.p50PositionDurationMs.min)} - ${formatDurationMs(this.bounds.p50PositionDurationMs.max)}]`
    );
    this.logger.info(
      `  MaxPositionDurationMs: [${formatDurationMs(this.bounds.maxPositionDurationMs.min)} - ${formatDurationMs(this.bounds.maxPositionDurationMs.max)}]`
    );
    this.logger.info(
      `  LowerPositionPnl: [${formatMoney(this.bounds.lowerPositionPnl.min)} - ${formatMoney(this.bounds.lowerPositionPnl.max)}]`
    );
    this.logger.info(
      `  PotentialMaxLoss: [${formatMoney(this.bounds.potentialMaxLoss.min)} - ${formatMoney(this.bounds.potentialMaxLoss.max)}]`
    );
    this.logger.info(
      `  P95 MAE: [${this.bounds.p95MAE.min.toFixed(2)}% - ${this.bounds.p95MAE.max.toFixed(2)}%]`
    );
  }

  private calculateFitness(result: EvaluationResult): number {
    if (!this.bounds) {
      throw new Error('ConfigOptimizer: cannot calculate fitness before bounds are set.');
    }
    const pnlNorm = this.normalize(result.pnl, this.bounds.pnl);
    const p10PnlNorm = this.normalize(result.p10Pnl, this.bounds.p10Pnl);
    const sharpeRatioNorm = this.normalizeSharpeRatio(result.sharpeRatio);
    const profitFactorNorm = this.normalizeProfitFactor(result.profitFactor);
    const winRateNorm = this.clamp(result.winRate / 100, 0, 1);
    const p50PositionDurationMsNorm = this.invertNormalize(
      result.p50PositionDurationMs,
      this.bounds.p50PositionDurationMs
    );
    const maxPositionDurationMsNorm = this.invertNormalize(
      result.maxPositionDurationMs,
      this.bounds.maxPositionDurationMs
    );
    const numPositionsNorm = this.normalize(result.numPositions, this.bounds.numPositions);

    const lowerPnlNorm = this.normalize(result.lowerPositionPnl, this.bounds.lowerPositionPnl);
    const p95MAENorm = this.invertNormalize(result.p95MAE, this.bounds.p95MAE);
    const potentialLossNorm = this.invertNormalize(
      result.potentialMaxLoss,
      this.bounds.potentialMaxLoss
    );

    const weights = this.botConfig.configOptimizerGenetic?.weights ?? {};

    let fitness =
      this.getFitnessWeight(weights, 'pnl') * pnlNorm +
      this.getFitnessWeight(weights, 'p10Pnl') * p10PnlNorm +
      this.getFitnessWeight(weights, 'sharpeRatio') * sharpeRatioNorm +
      this.getFitnessWeight(weights, 'profitFactor') * profitFactorNorm +
      this.getFitnessWeight(weights, 'winRate') * winRateNorm +
      this.getFitnessWeight(weights, 'p50PositionDurationMs') * p50PositionDurationMsNorm +
      this.getFitnessWeight(weights, 'numPositions') * numPositionsNorm +
      this.getFitnessWeight(weights, 'lowerPositionPnl') * lowerPnlNorm +
      this.getFitnessWeight(weights, 'potentialMaxLoss') * potentialLossNorm +
      this.getFitnessWeight(weights, 'maxPositionDurationMs') * maxPositionDurationMsNorm +
      this.getFitnessWeight(weights, 'p95MAE') * p95MAENorm;

    if (result.pnl < 0) {
      fitness *= 0.5;
    }

    if (result.walkForwardFoldCount > 0) {
      fitness *= this.getWalkForwardRobustnessMultiplier(result);
    }

    // Safety check: ensure fitness is always a finite number
    if (!Number.isFinite(fitness)) {
      return 0;
    }

    return fitness;
  }

  private normalizeSharpeRatio(value: number): number {
    if (!Number.isFinite(value)) {
      return value > 0 ? 1 : 0;
    }

    return this.clamp(value / 3, 0, 1);
  }

  private normalizeProfitFactor(value: number): number {
    if (!Number.isFinite(value)) {
      return value > 0 ? 1 : 0;
    }

    return this.clamp((value - 1) / 2, 0, 1);
  }

  private getWalkForwardRobustnessMultiplier(result: EvaluationResult): number {
    const pnlRetention = this.clamp(result.walkForwardPnlRetention, 0, 1);
    const positiveFoldRate = this.clamp(result.walkForwardPositiveFoldRate, 0, 1);
    const activeFoldRate = this.clamp(result.walkForwardActiveFoldRate, 0, 1);
    const sufficientFoldRate =
      this.walkForwardSettings.minTestTrades > 0
        ? this.clamp(result.walkForwardSufficientFoldRate, 0, 1)
        : 1;
    const robustness = (pnlRetention + positiveFoldRate + activeFoldRate + sufficientFoldRate) / 4;

    return 0.5 + robustness * 0.5;
  }

  private getWalkForwardSummary(): string {
    if (this.walkForwardFolds <= 0) {
      return 'Walk-forward evaluation disabled.';
    }

    const settings = this.walkForwardSettings;
    return `Walk-forward evaluation enabled with ${this.walkForwardWindows.length} folds (${settings.mode}, train ${settings.trainWindowDays}d, test ${settings.testWindowDays}d, step ${settings.stepWindowDays}d, embargo ${settings.embargoDays}d, min ${settings.minTestTrades} trades/fold).`;
  }

  private normalize(value: number, bounds: { min: number; max: number }): number {
    if (!Number.isFinite(value)) {
      return 0.5;
    }
    if (!Number.isFinite(bounds.min) || !Number.isFinite(bounds.max)) {
      return 0.5;
    }
    if (bounds.max === bounds.min) {
      return 0.5;
    }
    const normalized = (value - bounds.min) / (bounds.max - bounds.min);
    if (!Number.isFinite(normalized)) {
      return 0.5;
    }

    return this.clamp(normalized, 0, 1);
  }

  private invertNormalize(value: number, bounds: { min: number; max: number }): number {
    return 1 - this.normalize(value, bounds);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private finalizeDiscoveryHistory(): void {
    if (this.discoveryHistory.length === 0) {
      return;
    }

    if (this.walkForwardWindows.length > 0) {
      this.discoveryHistory = [];
      return;
    }

    for (const evaluation of this.discoveryHistory) {
      evaluation.fitness = this.calculateFitness(evaluation);
      this.recordCompletedEvaluation(evaluation);
      this.updateRanking(evaluation);
    }

    this.discoveryHistory = [];
  }

  private recordCompletedEvaluation(evaluation: EvaluationResult): void {
    this.evaluationHistory.push(evaluation);
    this.totalEvaluations++;

    if (!this.reportEnabled || !Number.isFinite(evaluation.fitness)) {
      return;
    }

    this.report.addFitnessValue(evaluation.fitness ?? 0);
    this.report.addWinRateValue(evaluation.winRate);
  }

  private saveSnapshotFiles(): void {
    const saveBuffer = (buffer: EvaluationResult[], label: 'pnl' | 'fitness') => {
      for (let i = 0; i < Math.min(NUM_SNAPSHOTS_TO_SAVE, buffer.length); i++) {
        const result = buffer[i];
        if (!result) {
          continue;
        }

        const filePath = path.resolve(
          process.cwd(),
          `outputs/configs/${this.mode}_best_${label}_config_snapshot_${i + 1}.json`
        );
        ensureFolderInPath(filePath);
        const finalConfig = new BotConfig();
        finalConfig.loadFromFile(config.general.botConfigFilePath);
        finalConfig.setSerializedConfig(result.config ?? {});
        finalConfig.saveToFile(filePath);
      }
    };

    saveBuffer(this.bestPnl.getAll(), 'pnl');
    saveBuffer(this.bestFitness.getAll(), 'fitness');
  }

  /**
   * This method postprocess the ranking of evaluation results.
   * Managing any additional logic needed to finalize the ranking after evaluations.
   * IE: Adding the setting for StopLossMAEExitStrategy values based on discovered results, etc
   * Function modifies the result in place by reference and returns the same object ref.
   * @param evaluationResult
   */
  private _postProcessRanking(result: EvaluationResult): EvaluationResult {
    return result;
  }

  private updateRanking(result: EvaluationResult): void {
    const filterConfigOptimizerMinRank =
      this.botConfig.configOptimizerGenetic.filterMinWeights ?? {};
    // Reject results that don't meet minimum thresholds
    for (const [filterKey, minValue] of Object.entries(filterConfigOptimizerMinRank)) {
      if (
        filterKey &&
        filterKey in result &&
        (result[filterKey as keyof EvaluationResult] as number) < minValue
      ) {
        return;
      }
    }

    // Always add to fitness ranking to track progress (even if negative)
    // The OrderedBuffer will sort by fitness automatically
    const fitness = result.fitness ?? 0;

    const bestFitnessBuffer = this.bestFitness.getAll();
    const bestPnlBuffer = this.bestPnl.getAll();

    if (!this.rankingContainsResult(bestFitnessBuffer, result)) {
      if (
        !this.bestFitness.isFull() ||
        fitness > (this.bestFitness.getLast()?.fitness ?? Number.NEGATIVE_INFINITY)
      ) {
        this.bestFitness.add(this._postProcessRanking(result), fitness);
      }
    }

    if (!this.rankingContainsResult(bestPnlBuffer, result)) {
      if (
        !this.bestPnl.isFull() ||
        result.pnl > (this.bestPnl.getLast()?.pnl ?? Number.NEGATIVE_INFINITY)
      ) {
        this.bestPnl.add(this._postProcessRanking(result), result.pnl);
      }
    }
  }

  private saveReport(): void {
    const reportSections = [
      this.getBestPreview(),
      this.report.getFitnessDistributionReport(),
    ].filter((section) => section.trim().length > 0);
    const ansiReport = reportSections.join(os.EOL + os.EOL);
    const reportPath = path.resolve(
      process.cwd(),
      `outputs/configs/${this.mode}_optimization_report.txt`
    );
    ensureFolderInPath(reportPath);
    fs.writeFileSync(
      reportPath,
      ansis.strip(ansiReport) + os.EOL + os.EOL + os.EOL + ansiReport,
      'utf8'
    );
    this.logger.info(ansis.green(`Optimization report saved to: ${reportPath}`));
  }

  private saveParameterStabilityHeatmap(): void {
    if (this.mode !== 'genetic' || this.evaluationHistory.length === 0) {
      return;
    }

    const stabilityHeatmap = new ConfigOptimizerStabilityHeatmap(this.botConfig);
    const output = stabilityHeatmap.save({
      evaluations: this.evaluationHistory,
      mode: this.mode,
      walkForwardFolds: this.walkForwardWindows.length,
      startTimestampMs: this.startTimestampMs,
      endTimestampMs: this.endTimestampMs,
    });

    if (!output) {
      this.logger.warn('ConfigOptimizer: parameter stability heatmap was skipped.');
      return;
    }

    this.logger.info(ansis.green(`Parameter stability heatmap saved to: ${output.htmlPath}`));
    this.logger.info(ansis.green(`Parameter stability data saved to: ${output.jsonPath}`));
  }

  private printProgress(
    configs: BotConfig[],
    discoveryMode: boolean = false,
    progress?: { total: number; processedOffset: number }
  ): void {
    const printEvery = 10;
    if (this.results.length === 0) {
      return;
    }
    if (this.results.length % printEvery !== 0 && this.results.length < configs.length) {
      return;
    }

    const isCumulativeProgress = Boolean(progress);
    let elapsedMs: number;

    if (isCumulativeProgress) {
      this.cumulativeProgressStartTimeMs ??= Date.now();
      elapsedMs = Date.now() - this.cumulativeProgressStartTimeMs;
    } else {
      if (
        this.localProgressStartTimeMs === null ||
        this.results.length < this.lastLocalProgressCount
      ) {
        this.localProgressStartTimeMs = Date.now();
      }
      this.lastLocalProgressCount = this.results.length;
      elapsedMs = Date.now() - this.localProgressStartTimeMs;
    }

    const total = progress?.total ?? configs.length;
    const processed = (progress?.processedOffset ?? 0) + this.results.length;
    const percent = ((processed / total) * 100).toFixed(2);
    const configsPerSec = elapsedMs > 0 ? processed / (elapsedMs / 1000) : 0;

    const remaining = Math.max(total - processed, 0);
    const etaSeconds = configsPerSec > 0 ? remaining / configsPerSec : Number.POSITIVE_INFINITY;
    const etaMinutes = Math.floor(etaSeconds / 60);
    const etaSecs = Math.max(0, Math.round(etaSeconds % 60));
    const etaDisplay = Number.isFinite(etaSeconds) ? `${etaMinutes}m ${etaSecs}s` : '∞';

    let preview: string;
    if (discoveryMode) {
      // In discovery mode, show simpler progress without fitness (not yet calculated)
      preview = `🔍 Discovering boundaries... ${ansis.cyan(
        percent + `%`
      )} (${processed}/${total}) (${configsPerSec.toFixed(2)} c/s - ETA: ${etaDisplay})`;
    } else {
      preview = this.getBestPreview();
      const genInfo = this.currentGeneration > 0 ? `Gen ${this.currentGeneration}` : '';
      preview += `🚀 (⚙️  ${genInfo}) ${ansis.cyan(percent + `%`)} (${configsPerSec.toFixed(2)} c/s - ETA: ${etaDisplay})`;
    }

    this.outputReport = preview;

    const SAME_LINE = true;

    if ((SAME_LINE || discoveryMode) && process.stdout.isTTY) {
      const terminalWidth = Math.max(process.stdout.columns ?? 80, 40);
      const previewRows = this.getRenderedRowCount(preview, terminalWidth);
      const lastRows = this.lastPreviewRows;

      if (lastRows > 0) {
        process.stdout.write('\r');
        for (let i = 0; i < lastRows; i++) {
          process.stdout.write('\x1b[2K'); // clear current line
          if (i < lastRows - 1) {
            process.stdout.write('\x1b[1A'); // move cursor up
          }
        }
        process.stdout.write('\r');
      }

      process.stdout.write(preview);
      this.lastPreviewRows = previewRows;
    } else {
      this.logger.info(preview);
    }
  }

  private getRenderedRowCount(text: string, terminalWidth: number): number {
    return text.split(os.EOL).reduce((rows, line) => {
      const visibleWidth = Array.from(ansis.strip(line).replace(/\t/g, '  ')).length;
      return rows + Math.max(1, Math.ceil(visibleWidth / terminalWidth));
    }, 0);
  }

  private getBestPreview(): string {
    let preview = '';
    const bar = ansis.red('|');
    const bestFitnessBuffer = this.bestFitness.getAll();
    const bestPnlBuffer = this.bestPnl.getAll();

    const getBestInfo = (best: EvaluationResult | null) => {
      if (!best) {
        return 'n/a';
      }
      const walkForwardInfo =
        best.walkForwardFoldCount > 0
          ? ` ${bar} WFO: ${(best.walkForwardPositiveFoldRate * 100).toFixed(0)}% green / ${(best.walkForwardActiveFoldRate * 100).toFixed(0)}% active / ${(best.walkForwardSufficientFoldRate * 100).toFixed(0)}% reliable / ${(best.walkForwardPnlRetention * 100).toFixed(0)}% retained`
          : '';
      return `Ftn: ${ansis.yellow((best.fitness ?? 0).toFixed(3))} ${bar} PNL: ${formatMoney(
        best.pnl
      )} (P10: ${formatMoney(best.p10Pnl)}) ${bar} SR: ${ansis.yellow(
        formatPerformanceMetric(best.sharpeRatio)
      )} PF: ${ansis.yellow(formatPerformanceMetric(best.profitFactor))} ${bar} WR: ${ansis.yellow(
        `${best.winRate.toFixed(2)}%`
      )} (NumPos: ${ansis.cyan(best.numPositions.toFixed(0))}) ${bar} P50 Hold: ${formatDurationMs(best.p50PositionDurationMs)} Max: ${formatDurationMs(best.maxPositionDurationMs)} ${bar} P95 MAE: ${best.p95MAE.toFixed(2)}%${walkForwardInfo}`;
    };

    preview = '';
    preview += ansis.cyan(
      '════════════════════════════════════════════════════════════════════════════════════════════════════════════'
    );
    preview += os.EOL;
    preview += ansis.cyan.bold(
      `   🏆 Ranking TOP Fitness (Walk-Forward OOS: ${this.walkForwardWindows.length} folds) 🏋️`
    );
    preview += os.EOL;
    preview += ansis.cyan(
      '════════════════════════════════════════════════════════════════════════════════════════════════════════════'
    );
    preview += os.EOL;
    for (let i = 1; i <= PROGRESS_SHOW_TOP_AMOUNT; i++) {
      preview += `FTN #${i} -> ${getBestInfo(bestFitnessBuffer[i - 1] ?? null)}`;
      preview += os.EOL;
    }
    preview += ansis.cyan(
      '════════════════════════════════════════════════════════════════════════════════════════════════════════════'
    );
    preview += os.EOL;
    preview += ansis.cyan.bold(
      `   🏆 Ranking TOP PNL (Walk-Forward OOS: ${this.walkForwardWindows.length} folds) 💵`
    );
    preview += os.EOL;
    preview += ansis.cyan(
      '════════════════════════════════════════════════════════════════════════════════════════════════════════════'
    );
    preview += os.EOL;
    for (let i = 1; i <= PROGRESS_SHOW_TOP_AMOUNT; i++) {
      preview += `PNL #${i} -> ${getBestInfo(bestPnlBuffer[i - 1] ?? null)}`;
      preview += os.EOL;
    }
    preview += ansis.cyan(
      '════════════════════════════════════════════════════════════════════════════════════════════════════════════'
    );
    preview += os.EOL;
    return preview;
  }
}
