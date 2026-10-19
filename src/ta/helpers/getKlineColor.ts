import type { ALXKline } from '@/domain/ALXKline';

export type KlineColor = 'green' | 'red' | 'neutral';

/**
 * Determines the color of a kline based on its open and close prices.
 *
 * @param kline - The kline to analyze
 * @returns 'green' for bullish (close > open), 'red' for bearish (close < open), 'neutral' for doji (close === open)
 */
export function getKlineColor(kline: ALXKline): KlineColor {
  if (kline.close > kline.open) {
    return 'green';
  }
  if (kline.close < kline.open) {
    return 'red';
  }
  return 'neutral';
}
