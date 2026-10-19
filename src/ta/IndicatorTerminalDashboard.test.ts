import { describe, expect, test } from 'bun:test';
import { formatIndicatorValue } from './IndicatorTerminalDashboard';

describe('formatIndicatorValue', () => {
  test('formats numeric values with precision based on magnitude', () => {
    expect(formatIndicatorValue(1234.56789)).toBe('1,234.57');
    expect(formatIndicatorValue(12.345678)).toBe('12.3457');
    expect(formatIndicatorValue(0.000123456789)).toBe('0.00012346');
  });

  test('formats nested indicator objects into a compact single-line string', () => {
    expect(
      formatIndicatorValue({
        trend: 'up',
        bands: {
          upper: 123.456789,
          lower: 120.123456,
        },
      })
    ).toBe('{ trend: up, bands: { upper: 123.4568, lower: 120.1235 } }');
  });

  test('limits large arrays and object entry counts', () => {
    expect(formatIndicatorValue([1, 2, 3, 4, 5])).toBe('[1, 2, 3, 4, …]');
    expect(
      formatIndicatorValue({
        a: 1,
        b: 2,
        c: 3,
        d: 4,
        e: 5,
        f: 6,
        g: 7,
      })
    ).toBe('{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, … }');
  });
});
