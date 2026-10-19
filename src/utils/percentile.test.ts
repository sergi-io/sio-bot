import { describe, test, expect } from 'bun:test';
import { percentile } from './percentile';

describe('percentile', () => {
  test('returns 0 for empty data', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  test('throws for percentile < 0 or > 1', () => {
    expect(() => percentile([1, 2, 3], -0.1)).toThrow();
    expect(() => percentile([1, 2, 3], 1.1)).toThrow();
  });

  test('returns the only value when array has one element', () => {
    expect(percentile([42], 0.3)).toBe(42);
  });

  test('returns min for percentile 0 and max for percentile 1', () => {
    const data = [5, 10, 1, 7];
    expect(percentile(data, 0)).toBe(1);
    expect(percentile(data, 1)).toBe(10);
  });

  test('handles already sorted and unsorted data equivalently', () => {
    expect(percentile([1, 3, 5, 7, 9], 0.5)).toBe(percentile([9, 1, 7, 3, 5], 0.5));
  });

  test('computes median (50th percentile) correctly', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
  });

  test('performs linear interpolation for non-integer positions', () => {
    // For sorted [10, 20, 30], position = 0.25 * (3 - 1) = 0.5 => between 10 and 20
    expect(percentile([10, 20, 30], 0.25)).toBeCloseTo(15, 10);
    // For sorted [1, 2, 4, 8], position = 0.75 * 3 = 2.25 => between 4 and 8
    expect(percentile([1, 2, 4, 8], 0.75)).toBeCloseTo(5, 10);
  });

  test('handles high percentiles close to 1', () => {
    const data = [5, 15, 25, 35, 45];
    expect(percentile(data, 0.99)).toBeCloseTo(44.6, 10);
  });
});
