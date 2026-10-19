import { describe, test, expect } from 'bun:test';
import { getKlineColor } from './getKlineColor';
import type { ALXKline } from '@/domain/ALXKline';

describe('getKlineColor', () => {
  test('returns green for bullish kline (close > open)', () => {
    const kline: ALXKline = {
      type: 'full',
      pair: 'TEST/USDT',
      timeframe: '1m',
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      buyVolume: 1000,
      sellVolume: 0,
      buyCost: 0,
      sellCost: 0,
      liqBuyCost: 0,
      liqSellCost: 0,
      liqBuyVolume: 0,
      liqSellVolume: 0,
      tradeCount: 0,
      liqCount: 0,
    };
    expect(getKlineColor(kline)).toBe('green');
  });

  test('returns red for bearish kline (close < open)', () => {
    const kline: ALXKline = {
      type: 'full',
      pair: 'TEST/USDT',
      timeframe: '1m',
      timestamp: 1000,
      open: 100,
      high: 105,
      low: 90,
      close: 95,
      buyVolume: 1000,
      sellVolume: 0,
      buyCost: 0,
      sellCost: 0,
      liqBuyCost: 0,
      liqSellCost: 0,
      liqBuyVolume: 0,
      liqSellVolume: 0,
      tradeCount: 0,
      liqCount: 0,
    };
    expect(getKlineColor(kline)).toBe('red');
  });

  test('returns neutral for doji kline (close === open)', () => {
    const kline: ALXKline = {
      type: 'full',
      pair: 'TEST/USDT',
      timeframe: '1m',
      timestamp: 1000,
      open: 100,
      high: 105,
      low: 95,
      close: 100,
      buyVolume: 1000,
      sellVolume: 0,
      buyCost: 0,
      sellCost: 0,
      liqBuyCost: 0,
      liqSellCost: 0,
      liqBuyVolume: 0,
      liqSellVolume: 0,
      tradeCount: 0,
      liqCount: 0,
    };
    expect(getKlineColor(kline)).toBe('neutral');
  });

  test('returns green for very small bullish movement', () => {
    const kline: ALXKline = {
      type: 'full',
      pair: 'TEST/USDT',
      timeframe: '1m',
      timestamp: 1000,
      open: 100.0,
      high: 100.01,
      low: 99.99,
      close: 100.001,
      buyVolume: 1000,
      sellVolume: 0,
      buyCost: 0,
      sellCost: 0,
      liqBuyCost: 0,
      liqSellCost: 0,
      liqBuyVolume: 0,
      liqSellVolume: 0,
      tradeCount: 0,
      liqCount: 0,
    };
    expect(getKlineColor(kline)).toBe('green');
  });

  test('returns red for very small bearish movement', () => {
    const kline: ALXKline = {
      type: 'full',
      pair: 'TEST/USDT',
      timeframe: '1m',
      timestamp: 1000,
      open: 100.0,
      high: 100.01,
      low: 99.99,
      close: 99.999,
      buyVolume: 1000,
      sellVolume: 0,
      buyCost: 0,
      sellCost: 0,
      liqBuyCost: 0,
      liqSellCost: 0,
      liqBuyVolume: 0,
      liqSellVolume: 0,
      tradeCount: 0,
      liqCount: 0,
    };
    expect(getKlineColor(kline)).toBe('red');
  });

  test('returns green for strong bullish kline', () => {
    const kline: ALXKline = {
      type: 'full',
      pair: 'TEST/USDT',
      timeframe: '1m',
      timestamp: 1000,
      open: 100,
      high: 150,
      low: 100,
      close: 145,
      buyVolume: 5000,
      sellVolume: 0,
      buyCost: 0,
      sellCost: 0,
      liqBuyCost: 0,
      liqSellCost: 0,
      liqBuyVolume: 0,
      liqSellVolume: 0,
      tradeCount: 0,
      liqCount: 0,
    };
    expect(getKlineColor(kline)).toBe('green');
  });

  test('returns red for strong bearish kline', () => {
    const kline: ALXKline = {
      type: 'full',
      pair: 'TEST/USDT',
      timeframe: '1m',
      timestamp: 1000,
      open: 100,
      high: 100,
      low: 50,
      close: 55,
      buyVolume: 5000,
      sellVolume: 0,
      buyCost: 0,
      sellCost: 0,
      liqBuyCost: 0,
      liqSellCost: 0,
      liqBuyVolume: 0,
      liqSellVolume: 0,
      tradeCount: 0,
      liqCount: 0,
    };
    expect(getKlineColor(kline)).toBe('red');
  });

  test('handles zero values correctly', () => {
    const dojiKline: ALXKline = {
      type: 'full',
      pair: 'TEST/USDT',
      timeframe: '1m',
      timestamp: 1000,
      open: 0,
      high: 0,
      low: 0,
      close: 0,
      buyVolume: 0,
      sellVolume: 0,
      buyCost: 0,
      sellCost: 0,
      liqBuyCost: 0,
      liqSellCost: 0,
      liqBuyVolume: 0,
      liqSellVolume: 0,
      tradeCount: 0,
      liqCount: 0,
    };
    expect(getKlineColor(dojiKline)).toBe('neutral');
  });
});
