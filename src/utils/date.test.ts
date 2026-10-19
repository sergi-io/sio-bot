import { describe, test, expect, afterEach } from 'bun:test';
import {
  getCurrentTimestampMs,
  calcDurationMs,
  getWeekDaysEnabled,
  getWeekDayFromTimestampMs,
  WeekDays,
  getEndOfDayTimestampMs,
  parseDateToMs,
  formatDateTimeFromMs,
} from './date';

const originalDateNow = Date.now;

afterEach(() => {
  Date.now = originalDateNow;
});

describe('getCurrentTimestampMs', () => {
  test('returns value from Date.now', () => {
    const fakeNow = 1_697_000_000_000;
    Date.now = () => fakeNow;
    expect(getCurrentTimestampMs()).toBe(fakeNow);
  });
});

describe('calcDurationMs', () => {
  test('formats durations under one day', () => {
    const hours = 2;
    const minutes = 34;
    const seconds = 12;
    const diff = ((hours * 60 + minutes) * 60 + seconds) * 1000;
    expect(calcDurationMs(0, diff)).toBe('2h34m12s');
  });

  test('formats durations over multiple days', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const hourMs = 60 * 60 * 1000;
    const minuteMs = 60 * 1000;
    const secondMs = 1000;
    const diff = 2 * dayMs + 3 * hourMs + 4 * minuteMs + 5 * secondMs;
    expect(calcDurationMs(0, diff)).toBe('2d3h4m5s');
  });

  test('clamps negative differences to zero', () => {
    expect(calcDurationMs(5_000, 2_000)).toBe('0h0m0s');
  });

  test('handles zero difference', () => {
    expect(calcDurationMs(10_000, 10_000)).toBe('0h0m0s');
  });

  test('drops fractional seconds via flooring', () => {
    expect(calcDurationMs(0, 3_999)).toBe('0h0m3s');
  });

  test('returns dash for invalid numeric inputs', () => {
    expect(calcDurationMs(NaN, 1_000)).toBe('-');
    expect(calcDurationMs(1_000, NaN)).toBe('-');
  });
});

describe('getWeekDaysEnabled', () => {
  test('returns all days disabled for bitmask 0', () => {
    const result = getWeekDaysEnabled(0b0000000);
    expect(result).toEqual({
      [WeekDays.MON]: false,
      [WeekDays.TUE]: false,
      [WeekDays.WED]: false,
      [WeekDays.THU]: false,
      [WeekDays.FRI]: false,
      [WeekDays.SAT]: false,
      [WeekDays.SUN]: false,
    });
  });

  test('returns all days enabled for bitmask 127 (0b1111111)', () => {
    const result = getWeekDaysEnabled(0b1111111);
    expect(result).toEqual({
      [WeekDays.MON]: true,
      [WeekDays.TUE]: true,
      [WeekDays.WED]: true,
      [WeekDays.THU]: true,
      [WeekDays.FRI]: true,
      [WeekDays.SAT]: true,
      [WeekDays.SUN]: true,
    });
  });

  test('enables only Monday for bitmask 64 (0b1000000)', () => {
    const result = getWeekDaysEnabled(0b1000000);
    expect(result).toEqual({
      [WeekDays.MON]: true,
      [WeekDays.TUE]: false,
      [WeekDays.WED]: false,
      [WeekDays.THU]: false,
      [WeekDays.FRI]: false,
      [WeekDays.SAT]: false,
      [WeekDays.SUN]: false,
    });
  });

  test('enables only Sunday for bitmask 1 (0b0000001)', () => {
    const result = getWeekDaysEnabled(0b0000001);
    expect(result).toEqual({
      [WeekDays.MON]: false,
      [WeekDays.TUE]: false,
      [WeekDays.WED]: false,
      [WeekDays.THU]: false,
      [WeekDays.FRI]: false,
      [WeekDays.SAT]: false,
      [WeekDays.SUN]: true,
    });
  });

  test('enables weekdays only (Mon-Fri) for bitmask 124 (0b1111100)', () => {
    const result = getWeekDaysEnabled(0b1111100);
    expect(result).toEqual({
      [WeekDays.MON]: true,
      [WeekDays.TUE]: true,
      [WeekDays.WED]: true,
      [WeekDays.THU]: true,
      [WeekDays.FRI]: true,
      [WeekDays.SAT]: false,
      [WeekDays.SUN]: false,
    });
  });

  test('enables weekend only (Sat-Sun) for bitmask 3 (0b0000011)', () => {
    const result = getWeekDaysEnabled(0b0000011);
    expect(result).toEqual({
      [WeekDays.MON]: false,
      [WeekDays.TUE]: false,
      [WeekDays.WED]: false,
      [WeekDays.THU]: false,
      [WeekDays.FRI]: false,
      [WeekDays.SAT]: true,
      [WeekDays.SUN]: true,
    });
  });

  test('enables specific days (Tue, Thu, Sat) for bitmask 42 (0b0101010)', () => {
    const result = getWeekDaysEnabled(0b0101010);
    expect(result).toEqual({
      [WeekDays.MON]: false,
      [WeekDays.TUE]: true,
      [WeekDays.WED]: false,
      [WeekDays.THU]: true,
      [WeekDays.FRI]: false,
      [WeekDays.SAT]: true,
      [WeekDays.SUN]: false,
    });
  });

  test('handles decimal input equivalent to binary', () => {
    // 127 is 0b1111111 (all days enabled)
    const result = getWeekDaysEnabled(127);
    expect(result[WeekDays.MON]).toBe(true);
    expect(result[WeekDays.SUN]).toBe(true);
  });

  test('ignores bits beyond the 7 least significant bits', () => {
    // 255 is 0b11111111, but only last 7 bits matter
    const result = getWeekDaysEnabled(255);
    expect(result).toEqual({
      [WeekDays.MON]: true,
      [WeekDays.TUE]: true,
      [WeekDays.WED]: true,
      [WeekDays.THU]: true,
      [WeekDays.FRI]: true,
      [WeekDays.SAT]: true,
      [WeekDays.SUN]: true,
    });
  });
});

describe('getWeekDayFromTimestampMs', () => {
  test('returns Monday for a known Monday timestamp', () => {
    // 2024-01-01 00:00:00 UTC is a Monday
    const mondayMs = Date.UTC(2024, 0, 1, 0, 0, 0);
    expect(getWeekDayFromTimestampMs(mondayMs)).toBe(WeekDays.MON);
  });

  test('returns Tuesday for a known Tuesday timestamp', () => {
    // 2024-01-02 00:00:00 UTC is a Tuesday
    const tuesdayMs = Date.UTC(2024, 0, 2, 0, 0, 0);
    expect(getWeekDayFromTimestampMs(tuesdayMs)).toBe(WeekDays.TUE);
  });

  test('returns Wednesday for a known Wednesday timestamp', () => {
    // 2024-01-03 00:00:00 UTC is a Wednesday
    const wednesdayMs = Date.UTC(2024, 0, 3, 0, 0, 0);
    expect(getWeekDayFromTimestampMs(wednesdayMs)).toBe(WeekDays.WED);
  });

  test('returns Thursday for a known Thursday timestamp', () => {
    // 2024-01-04 00:00:00 UTC is a Thursday
    const thursdayMs = Date.UTC(2024, 0, 4, 0, 0, 0);
    expect(getWeekDayFromTimestampMs(thursdayMs)).toBe(WeekDays.THU);
  });

  test('returns Friday for a known Friday timestamp', () => {
    // 2024-01-05 00:00:00 UTC is a Friday
    const fridayMs = Date.UTC(2024, 0, 5, 0, 0, 0);
    expect(getWeekDayFromTimestampMs(fridayMs)).toBe(WeekDays.FRI);
  });

  test('returns Saturday for a known Saturday timestamp', () => {
    // 2024-01-06 00:00:00 UTC is a Saturday
    const saturdayMs = Date.UTC(2024, 0, 6, 0, 0, 0);
    expect(getWeekDayFromTimestampMs(saturdayMs)).toBe(WeekDays.SAT);
  });

  test('returns Sunday for a known Sunday timestamp', () => {
    // 2024-01-07 00:00:00 UTC is a Sunday
    const sundayMs = Date.UTC(2024, 0, 7, 0, 0, 0);
    expect(getWeekDayFromTimestampMs(sundayMs)).toBe(WeekDays.SUN);
  });

  test('handles timestamps with non-zero time components', () => {
    // 2024-01-01 15:30:45 UTC is still a Monday
    const mondayMs = Date.UTC(2024, 0, 1, 15, 30, 45);
    expect(getWeekDayFromTimestampMs(mondayMs)).toBe(WeekDays.MON);
  });

  test('handles epoch timestamp (Thursday)', () => {
    // Unix epoch (0) is 1970-01-01 00:00:00 UTC, which was a Thursday
    expect(getWeekDayFromTimestampMs(0)).toBe(WeekDays.THU);
  });

  test('handles timestamps from different years', () => {
    // 2023-12-31 is a Sunday
    const sundayMs = Date.UTC(2023, 11, 31, 0, 0, 0);
    expect(getWeekDayFromTimestampMs(sundayMs)).toBe(WeekDays.SUN);
  });

  test('handles future timestamps', () => {
    // 2025-06-15 is a Sunday
    const futureMs = Date.UTC(2025, 5, 15, 0, 0, 0);
    expect(getWeekDayFromTimestampMs(futureMs)).toBe(WeekDays.SUN);
  });

  test('correctly uses UTC day, not local day', () => {
    // This test ensures we're using getUTCDay() correctly
    // 2024-01-01 23:59:59 UTC is still Monday
    const mondayMs = Date.UTC(2024, 0, 1, 23, 59, 59);
    expect(getWeekDayFromTimestampMs(mondayMs)).toBe(WeekDays.MON);
  });
});

describe('formatDateTimeFromMs', () => {
  test('formats timestamp as datetime string without milliseconds', () => {
    const ms = Date.UTC(2024, 0, 15, 10, 30, 45);
    expect(formatDateTimeFromMs(ms)).toBe('2024-01-15 10:30:45');
  });

  test('formats epoch timestamp', () => {
    expect(formatDateTimeFromMs(0)).toBe('1970-01-01 00:00:00');
  });

  test('formats timestamp at midnight', () => {
    const ms = Date.UTC(2024, 5, 20, 0, 0, 0);
    expect(formatDateTimeFromMs(ms)).toBe('2024-06-20 00:00:00');
  });

  test('formats timestamp at end of day', () => {
    const ms = Date.UTC(2024, 11, 31, 23, 59, 59);
    expect(formatDateTimeFromMs(ms)).toBe('2024-12-31 23:59:59');
  });

  test('ignores milliseconds in input', () => {
    const ms = Date.UTC(2024, 0, 15, 10, 30, 45, 999);
    expect(formatDateTimeFromMs(ms)).toBe('2024-01-15 10:30:45');
  });
});

describe('parseDateToMs', () => {
  test('parses date-only string as UTC midnight', () => {
    const result = parseDateToMs('2024-01-15');
    const expected = Date.UTC(2024, 0, 15, 0, 0, 0);
    expect(result).toBe(expected);
  });

  test('parses datetime with space separator as UTC', () => {
    const result = parseDateToMs('2024-01-15 10:30:00');
    const expected = Date.UTC(2024, 0, 15, 10, 30, 0);
    expect(result).toBe(expected);
  });

  test('parses datetime with T separator as UTC', () => {
    const result = parseDateToMs('2024-01-15T10:30:00');
    const expected = Date.UTC(2024, 0, 15, 10, 30, 0);
    expect(result).toBe(expected);
  });

  test('respects explicit Z timezone suffix', () => {
    const result = parseDateToMs('2024-01-15T10:30:00Z');
    const expected = Date.UTC(2024, 0, 15, 10, 30, 0);
    expect(result).toBe(expected);
  });

  test('respects explicit timezone offset', () => {
    const result = parseDateToMs('2024-01-15T10:30:00+02:00');
    // 10:30 UTC+2 = 08:30 UTC
    const expected = Date.UTC(2024, 0, 15, 8, 30, 0);
    expect(result).toBe(expected);
  });

  test('handles datetime with hours and minutes only', () => {
    const result = parseDateToMs('2024-01-15 10:30');
    const expected = Date.UTC(2024, 0, 15, 10, 30, 0);
    expect(result).toBe(expected);
  });

  test('trims whitespace from input', () => {
    const result = parseDateToMs('  2024-01-15 10:30:00  ');
    const expected = Date.UTC(2024, 0, 15, 10, 30, 0);
    expect(result).toBe(expected);
  });

  test('handles epoch date', () => {
    const result = parseDateToMs('1970-01-01');
    expect(result).toBe(0);
  });

  describe('getEndOfDayTimestampMs', () => {
    test('sets time to end of day in UTC', () => {
      // 2024-01-15 10:30:00 UTC
      const inputMs = Date.UTC(2024, 0, 15, 10, 30, 0);
      const result = getEndOfDayTimestampMs(inputMs);
      const expected = Date.UTC(2024, 0, 15, 23, 59, 59, 999);
      expect(result).toBe(expected);
    });

    test('handles start of day timestamp', () => {
      // 2024-01-15 00:00:00 UTC
      const inputMs = Date.UTC(2024, 0, 15, 0, 0, 0);
      const result = getEndOfDayTimestampMs(inputMs);
      const expected = Date.UTC(2024, 0, 15, 23, 59, 59, 999);
      expect(result).toBe(expected);
    });

    test('handles timestamp already at end of day', () => {
      // 2024-01-15 23:59:59.999 UTC
      const inputMs = Date.UTC(2024, 0, 15, 23, 59, 59, 999);
      const result = getEndOfDayTimestampMs(inputMs);
      expect(result).toBe(inputMs);
    });

    test('handles epoch timestamp', () => {
      const result = getEndOfDayTimestampMs(0);
      const expected = Date.UTC(1970, 0, 1, 23, 59, 59, 999);
      expect(result).toBe(expected);
    });

    test('preserves the date while changing time', () => {
      const inputMs = Date.UTC(2024, 5, 20, 12, 0, 0);
      const result = getEndOfDayTimestampMs(inputMs);
      const resultDate = new Date(result);
      expect(resultDate.getUTCFullYear()).toBe(2024);
      expect(resultDate.getUTCMonth()).toBe(5);
      expect(resultDate.getUTCDate()).toBe(20);
      expect(resultDate.getUTCHours()).toBe(23);
      expect(resultDate.getUTCMinutes()).toBe(59);
      expect(resultDate.getUTCSeconds()).toBe(59);
      expect(resultDate.getUTCMilliseconds()).toBe(999);
    });
  });
});
