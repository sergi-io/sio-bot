import { describe, test, expect } from 'bun:test';
import { calculateTrendSlope } from './calculateTrendSlope';

describe('calculateTrendSlope', () => {
  test('returns 0 when dataset has fewer than two points', () => {
    expect(calculateTrendSlope([])).toBe(0);
    expect(calculateTrendSlope([5])).toBe(0);
  });

  test('computes slope for strictly increasing data', () => {
    expect(calculateTrendSlope([1, 2, 3, 4, 5])).toBeCloseTo(1, 10);
  });

  test('computes slope for decreasing data', () => {
    expect(calculateTrendSlope([5, 4, 1])).toBeCloseTo(-2, 10);
  });

  test('returns zero slope for constant data', () => {
    expect(calculateTrendSlope([7, 7, 7, 7])).toBe(0);
  });

  test('handles floating point data with precision', () => {
    expect(calculateTrendSlope([1.1, 1.4, 2.2, 3.0])).toBeCloseTo(0.65, 2);
  });
});
