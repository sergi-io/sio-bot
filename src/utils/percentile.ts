/**
 * Calculates the percentile of an array of numbers using linear interpolation.
 * @param data - Array of numeric values
 * @param percentile - The target percentile (0-1, e.g., 0.95 for 95th percentile)
 * @returns The calculated percentile value, or 0 for empty arrays
 */
export function percentile(data: number[], percentile: number): number {
  // Input validation
  if (data.length === 0) return 0;
  if (percentile < 0 || percentile > 1) {
    throw new Error('Percentile must be between 0 and 1');
  }

  // Edge cases for performance
  if (data.length === 1) return data[0]!;
  if (percentile === 0) return Math.min(...data);
  if (percentile === 1) return Math.max(...data);

  // Sort the data
  const sorted = [...data].sort((a, b) => a - b);

  // Calculate position using the linear interpolation method
  const position = percentile * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  // If position is exactly on an index, return that value
  if (lower === upper) return sorted[lower]!;

  // Linear interpolation between the two nearest values
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}
