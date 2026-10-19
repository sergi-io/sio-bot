import type { RollingWindowBuffer } from '@/utils/RollingWindowBuffer';

export function upsertIndicatorBufferValue<T>(
  buffer: RollingWindowBuffer<T>,
  value: T,
  isPartialUpdate: boolean
): void {
  if (isPartialUpdate && !buffer.isEmpty) {
    buffer.pop();
  }
  buffer.push(value);
}
