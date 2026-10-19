import { describe, expect, test } from 'bun:test';
import { resolveCliDateRange } from './cliDateRange';

describe('resolveCliDateRange', () => {
  test('keeps configured datetime end when endDate is omitted', () => {
    const result = resolveCliDateRange({
      defaultStartDate: '2026-01-01',
      defaultEndDate: '2026-01-02 12:34:56',
    });

    expect(result.startTimestampMs).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(result.endTimestampMs).toBe(Date.parse('2026-01-02T12:34:56.000Z'));
  });

  test('expands explicit date-only endDate to the end of the day', () => {
    const result = resolveCliDateRange({
      defaultStartDate: '2026-01-01',
      defaultEndDate: '2026-01-02 12:34:56',
      endDate: '2026-03-05',
    });

    expect(result.endTimestampMs).toBe(Date.parse('2026-03-05T23:59:59.999Z'));
  });

  test('keeps explicit datetime endDate unchanged', () => {
    const result = resolveCliDateRange({
      defaultStartDate: '2026-01-01',
      defaultEndDate: '2026-01-02 12:34:56',
      endDate: '2026-03-05 14:15:16',
    });

    expect(result.endTimestampMs).toBe(Date.parse('2026-03-05T14:15:16.000Z'));
  });
});
