import { describe, expect, test } from 'bun:test';
import { DCARiskStrategy } from './DCARiskStrategy';
import type { SioBot } from '@/siobot/SioBot';

/**
 * Creates a mock SioBot with the specified configuration
 */
function createMockBot(options: {
  totalBalance: number;
  maxConcurrentPositions: number;
  minOrderSizeRate: number;
  maxOrderSizeUSDT?: number;
  dcaRiskStrategyMaxTimes: number;
  dcaRiskStrategySizeMultiplier: number;
}): SioBot {
  return {
    config: {
      riskMaxConcurrentPositions: { value: options.maxConcurrentPositions },
      riskMinOrderSizeRate: { value: options.minOrderSizeRate },
      riskMaxOrderSizeUSDT: { value: options.maxOrderSizeUSDT ?? Number.POSITIVE_INFINITY },
      dcaRiskStrategy_MaxTimes: { value: options.dcaRiskStrategyMaxTimes },
      dcaRiskStrategy_SizeMultiplier: { value: options.dcaRiskStrategySizeMultiplier },
    },
    exchange: {
      balanceManager: {
        getTotalBalance: () => options.totalBalance,
      },
    },
    isBackTesting: () => true,
  } as unknown as SioBot;
}

describe('DCARiskStrategy.calculateDCAOrderSize', () => {
  describe('with multiplier = 1 (equal distribution)', () => {
    test('should distribute evenly across all DCA levels', () => {
      const bot = createMockBot({
        totalBalance: 10000,
        maxConcurrentPositions: 1,
        minOrderSizeRate: 1,
        dcaRiskStrategyMaxTimes: 3,
        dcaRiskStrategySizeMultiplier: 1,
      });

      const strategy = new DCARiskStrategy(bot);

      // With multiplier=1 and dcaMaxTimes=3, series sum = 3+1 = 4
      // Each level gets totalCapital / 4 = 10000 / 4 = 2500
      expect(strategy.calculateDCAOrderSize(0)).toBe(2500);
      expect(strategy.calculateDCAOrderSize(1)).toBe(2500);
      expect(strategy.calculateDCAOrderSize(2)).toBe(2500);
      expect(strategy.calculateDCAOrderSize(3)).toBe(2500);
    });

    test('should respect minOrderSizeRate', () => {
      const bot = createMockBot({
        totalBalance: 10000,
        maxConcurrentPositions: 1,
        minOrderSizeRate: 0.5, // Only use 50% of capital
        dcaRiskStrategyMaxTimes: 3,
        dcaRiskStrategySizeMultiplier: 1,
      });

      const strategy = new DCARiskStrategy(bot);

      // totalCapitalPerPosition = 10000 * 0.5 = 5000
      // Each level gets 5000 / 4 = 1250
      expect(strategy.calculateDCAOrderSize(0)).toBe(1250);
      expect(strategy.calculateDCAOrderSize(1)).toBe(1250);
    });

    test('should divide capital by maxConcurrentPositions', () => {
      const bot = createMockBot({
        totalBalance: 10000,
        maxConcurrentPositions: 2, // Split across 2 positions
        minOrderSizeRate: 1,
        dcaRiskStrategyMaxTimes: 3,
        dcaRiskStrategySizeMultiplier: 1,
      });

      const strategy = new DCARiskStrategy(bot);

      // marginPerPosition = 10000 / 2 = 5000
      // Each level gets 5000 / 4 = 1250
      expect(strategy.calculateDCAOrderSize(0)).toBe(1250);
      expect(strategy.calculateDCAOrderSize(1)).toBe(1250);
    });
  });

  describe('with multiplier = 2 (geometric progression)', () => {
    test('should increase order size linearly with each DCA level x 1.5 multiplier', () => {
      const bot = createMockBot({
        totalBalance: 1000,
        maxConcurrentPositions: 1,
        minOrderSizeRate: 1,
        dcaRiskStrategyMaxTimes: 3,
        dcaRiskStrategySizeMultiplier: 1.5,
      });

      const strategy = new DCARiskStrategy(bot);

      expect(strategy.calculateDCAOrderSize(0)).toEqual(123);
      expect(strategy.calculateDCAOrderSize(1)).toEqual(184);
      expect(strategy.calculateDCAOrderSize(2)).toEqual(276);
      expect(strategy.calculateDCAOrderSize(3)).toEqual(415);
    });

    test('should increase order size linearly with each DCA level x 2 multiplier', () => {
      const bot = createMockBot({
        totalBalance: 1000,
        maxConcurrentPositions: 1,
        minOrderSizeRate: 1,
        dcaRiskStrategyMaxTimes: 3,
        dcaRiskStrategySizeMultiplier: 2,
      });

      const strategy = new DCARiskStrategy(bot);

      expect(strategy.calculateDCAOrderSize(0)).toEqual(66);
      expect(strategy.calculateDCAOrderSize(1)).toEqual(133);
      expect(strategy.calculateDCAOrderSize(2)).toEqual(266);
      expect(strategy.calculateDCAOrderSize(3)).toEqual(533);
    });

    test('should increase order size linearly with each DCA level x 3 multiplier and dcaMaxTimes 4', () => {
      const bot = createMockBot({
        totalBalance: 2000,
        maxConcurrentPositions: 1,
        minOrderSizeRate: 1,
        dcaRiskStrategyMaxTimes: 4,
        dcaRiskStrategySizeMultiplier: 3,
      });

      const strategy = new DCARiskStrategy(bot);
      expect(strategy.calculateDCAOrderSize(0)).toEqual(16);
      expect(strategy.calculateDCAOrderSize(1)).toEqual(49);
      expect(strategy.calculateDCAOrderSize(2)).toEqual(148);
      expect(strategy.calculateDCAOrderSize(3)).toEqual(446);
      expect(strategy.calculateDCAOrderSize(4)).toEqual(1338);
    });

    test('all DCA levels should sum to totalCapitalPerPosition', () => {
      const bot = createMockBot({
        totalBalance: 15000,
        maxConcurrentPositions: 1,
        minOrderSizeRate: 1,
        dcaRiskStrategyMaxTimes: 3,
        dcaRiskStrategySizeMultiplier: 2,
      });

      const strategy = new DCARiskStrategy(bot);

      const level0 = strategy.calculateDCAOrderSize(0);
      const level1 = strategy.calculateDCAOrderSize(1);
      const level2 = strategy.calculateDCAOrderSize(2);
      const level3 = strategy.calculateDCAOrderSize(3);

      expect(level0 + level1 + level2 + level3).toBe(15000);
    });

    test('all DCA levels should sum to totalCapitalPerPosition if minOrderSizeRate applied', () => {
      const bot = createMockBot({
        totalBalance: 15000,
        maxConcurrentPositions: 1,
        minOrderSizeRate: 0.2,
        dcaRiskStrategyMaxTimes: 3,
        dcaRiskStrategySizeMultiplier: 2,
      });

      const strategy = new DCARiskStrategy(bot);

      const level0 = strategy.calculateDCAOrderSize(0);
      const level1 = strategy.calculateDCAOrderSize(1);
      const level2 = strategy.calculateDCAOrderSize(2);
      const level3 = strategy.calculateDCAOrderSize(3);

      expect(level0 + level1 + level2 + level3).toBe(3000);
    });

    test('should cap each DCA order size to riskMaxOrderSizeUSDT', () => {
      const bot = createMockBot({
        totalBalance: 20000,
        maxConcurrentPositions: 1,
        minOrderSizeRate: 1,
        maxOrderSizeUSDT: 1000,
        dcaRiskStrategyMaxTimes: 3,
        dcaRiskStrategySizeMultiplier: 3,
      });

      const strategy = new DCARiskStrategy(bot);

      expect(strategy.calculateDCAOrderSize(0)).toEqual(500);
      expect(strategy.calculateDCAOrderSize(1)).toEqual(1000);
      expect(strategy.calculateDCAOrderSize(2)).toEqual(1000);
      expect(strategy.calculateDCAOrderSize(3)).toEqual(1000);
    });
  });
});
