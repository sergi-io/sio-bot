export function parseCsvNumberList(value: string | undefined): number[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);
}
