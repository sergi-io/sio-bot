import type { ALXKline } from '@/domain/ALXKline';
import type { SerializedBotConfig } from '@/siobot/BotConfig';

export type EvaluationResult = {
  config: SerializedBotConfig;
  finalBalance: number;
  pnl: number;
  p10Pnl: number;
  sharpeRatio: number;
  profitFactor: number;
  winRate: number;
  lowerPositionPnl: number;
  p50PositionDurationMs: number;
  maxPositionDurationMs: number;
  potentialMaxProfit: number;
  potentialMaxLoss: number;
  numPositions: number;
  p95MAE: number;
  walkForwardFoldCount: number;
  walkForwardTrainPnl: number;
  walkForwardTestPnl: number;
  walkForwardPnlRetention: number;
  walkForwardPositiveFoldRate: number;
  walkForwardActiveFoldRate: number;
  walkForwardTradeCount: number;
  walkForwardMinFoldTrades: number;
  walkForwardSufficientFoldRate: number;
  fitness?: number;
  runTimeMs: number;
};

export type OptimizerMode = 'bruteforce' | 'genetic';

export type WalkForwardWindow = {
  trainStart: number;
  trainEnd: number;
  embargoStart: number | null;
  embargoEnd: number | null;
  testStart: number;
  testEnd: number;
};

export type WorkerRequest =
  | {
      type: 'run';
      config: SerializedBotConfig;
      historicalKlines?: ALXKline[];
      initialBalance: number;
      defaultBotSerializedConfig: SerializedBotConfig;
      walkForwardWindows?: WalkForwardWindow[];
      walkForwardMinTestTrades?: number;
    }
  | { type: 'shutdown' };

export type WorkerResponse =
  | { type: 'result'; result: EvaluationResult }
  | { type: 'error'; error: string };
