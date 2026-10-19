import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const MS_THRESHOLD = 1_000_000_000_000;

export function normalizeHistoricalData(filePath: string): void {
  if (!filePath) {
    console.log('Usage: bun --normalize-historical-data <csv_file_path>');
    process.exit(1);
  }

  try {
    processCsv(filePath);
  } catch (error) {
    console.error('Error processing file:', filePath, error);
    process.exit(1);
  }
}

function processCsv(filePath: string): void {
  console.log('Normalizing CSV file:', filePath);
  const rawCsv = readFileSync(filePath, 'utf8');
  const records = parse(rawCsv, { skipEmptyLines: true }) as unknown[][];

  if (records.length === 0) {
    return;
  }

  const header = normalizeRow(records[0]!);
  const filtered: string[][] = [header];

  for (let i = 1; i < records.length; i += 1) {
    const row = normalizeRow(records[i]!);
    if (row.length === 0) {
      continue;
    }

    const isHeader =
      row.length === header.length && row.every((value, idx) => value === header[idx]);

    if (isHeader) {
      continue;
    }

    const candidate = Number.parseInt(row[0] ?? '', 10);
    if (Number.isFinite(candidate) && candidate > MS_THRESHOLD) {
      // row[0] = Math.floor(candidate / 1000).toString();
      row[0] = candidate.toString();
    }

    filtered.push(row);
  }

  const output = stringify(filtered);
  writeFileSync(filePath, output, 'utf8');
}

function normalizeRow(row: unknown[]): string[] {
  return (row ?? []).map((value) => (value === undefined || value === null ? '' : String(value)));
}
