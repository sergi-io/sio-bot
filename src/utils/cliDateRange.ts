import { getEndOfDayTimestampMs, parseDateToMs } from '@/utils/date';

type ResolveCliDateRangeParams = {
  startDate?: string;
  endDate?: string;
  defaultStartDate: string;
  defaultEndDate: string;
};

function isDateOnlyInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function resolveCliDateRange({
  startDate,
  endDate,
  defaultStartDate,
  defaultEndDate,
}: ResolveCliDateRangeParams): {
  startTimestampMs: number;
  endTimestampMs: number;
} {
  const startTimestampMs = parseDateToMs(startDate ?? defaultStartDate);
  const rawEndDate = endDate ?? defaultEndDate;
  let endTimestampMs = parseDateToMs(rawEndDate);

  if (endDate && isDateOnlyInput(endDate)) {
    endTimestampMs = getEndOfDayTimestampMs(endTimestampMs);
  }

  return {
    startTimestampMs,
    endTimestampMs,
  };
}
