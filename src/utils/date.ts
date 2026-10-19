export function getCurrentTimestampMs(): number {
  return Date.now();
}

export function calcDurationMs(initialMs: number, endMs: number): string {
  const diff = Math.max(0, endMs - initialMs);
  const msInSecond = 1000;
  const msInMinute = msInSecond * 60;
  const msInHour = msInMinute * 60;
  const msInDay = msInHour * 24;

  const days = Math.floor(diff / msInDay);
  const hours = Math.floor((diff % msInDay) / msInHour);
  const minutes = Math.floor((diff % msInHour) / msInMinute);
  const seconds = Math.floor((diff % msInMinute) / msInSecond);

  if (isNaN(days) || isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
    return '-';
  }

  if (days === 0) {
    return `${hours}h${minutes}m${seconds}s`;
  }
  return `${days}d${hours}h${minutes}m${seconds}s`;
}

export function formatDurationMs(ms: number): string {
  const diff = Math.max(0, ms);
  const msInSecond = 1000;
  const msInMinute = msInSecond * 60;
  const msInHour = msInMinute * 60;
  const msInDay = msInHour * 24;

  const days = Math.floor(diff / msInDay);
  const hours = Math.floor((diff % msInDay) / msInHour);
  const minutes = Math.floor((diff % msInHour) / msInMinute);
  const seconds = Math.floor((diff % msInMinute) / msInSecond);

  if (isNaN(days) || isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
    return '-';
  }

  if (days === 0) {
    return `${hours}h${minutes}m${seconds}s`;
  }
  return `${days}d${hours}h${minutes}m${seconds}s`;
}

export function formatDateFromMs(ms: number): string {
  const date = new Date(ms);
  return date.toISOString().split('T')[0]!;
}

export function formatDateTimeFromMs(ms: number): string {
  const date = new Date(ms);
  return date.toISOString().replace('T', ' ').slice(0, -5);
}

export function parseDateToMs(dateStr: string): number {
  // Normalize: replace space with 'T' to handle "YYYY-MM-DD HH:MM:SS" format
  let normalized = dateStr.trim().replace(' ', 'T');

  // If there's a time component but no timezone, append 'Z' to treat as UTC
  const hasTime = normalized.includes('T');
  const hasTimezone = normalized.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(normalized);

  if (hasTime && !hasTimezone) {
    normalized += 'Z';
  }

  const date = new Date(normalized);
  return date.getTime();
}

export function getEndOfDayTimestampMs(ms: number): number {
  const date = new Date(ms);
  date.setUTCHours(23, 59, 59, 999);
  return date.getTime();
}

export const enum WeekDays {
  MON = 'Mon',
  TUE = 'Tue',
  WED = 'Wed',
  THU = 'Thu',
  FRI = 'Fri',
  SAT = 'Sat',
  SUN = 'Sun',
}

export function getWeekDaysEnabled(bitmask: number): Record<WeekDays, boolean> {
  // Take into account that bit 0 = Monday, bit 6 = Sunday
  return {
    [WeekDays.MON]: (bitmask & 0b1000000) !== 0,
    [WeekDays.TUE]: (bitmask & 0b0100000) !== 0,
    [WeekDays.WED]: (bitmask & 0b0010000) !== 0,
    [WeekDays.THU]: (bitmask & 0b0001000) !== 0,
    [WeekDays.FRI]: (bitmask & 0b0000100) !== 0,
    [WeekDays.SAT]: (bitmask & 0b0000010) !== 0,
    [WeekDays.SUN]: (bitmask & 0b0000001) !== 0,
  };
}

export function getWeekDayFromTimestampMs(ms: number): WeekDays {
  const date = new Date(ms);
  const day = date.getUTCDay(); // 0 (Sun) to 6 (Sat)

  const dayToWeekMap: Record<number, WeekDays> = {
    0: WeekDays.SUN,
    1: WeekDays.MON,
    2: WeekDays.TUE,
    3: WeekDays.WED,
    4: WeekDays.THU,
    5: WeekDays.FRI,
    6: WeekDays.SAT,
  };

  return dayToWeekMap[day]!;
}

// #################################################################
// # Main
// #################################################################

if (import.meta.main) {
  console.log(getCurrentTimestampMs());
}
