import { config } from '@/config';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

function extractEnvValue(envContent: string, key: string): string {
  const lines = envContent.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice('export '.length) : trimmed;
    if (!withoutExport.startsWith(`${key}=`)) continue;
    const rawValue = withoutExport.slice(withoutExport.indexOf('=') + 1).trim();
    return rawValue.replace(/^['"]|['"]$/g, '');
  }
  throw new Error(`Missing ${key} in .env`);
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

export async function downloadHistoricalData(startDate?: string, endDate?: string): Promise<void> {
  const projectRoot = process.cwd();
  const envPath = path.join(projectRoot, '.env');

  const botConfig = await import(config.general.botConfigFilePath);
  const symbol = botConfig.assetSymbol;
  const timeframe = botConfig.assetTimeFrameToTrade;

  if (!symbol || !timeframe) {
    throw new Error(
      `assetSymbol or assetTimeFrame is missing from ${config.general.botConfigFilePath}`
    );
  }

  const envContent = await readFile(envPath, 'utf8');
  const _startDate = startDate ?? extractEnvValue(envContent, 'SIOBOT_BACK_TEST_DATE_START');
  const _endDate = endDate ?? extractEnvValue(envContent, 'SIOBOT_BACK_TEST_DATE_END');

  if (config.general.isBinary) {
    const currentBinary = process.execPath;
    await run(
      currentBinary,
      [
        'download-historical-binance-data',
        '--parallel',
        '10',
        '-d',
        _startDate,
        _endDate,
        '-p',
        'usd-m',
        '-t',
        'klines',
        '-s',
        symbol,
        '-i',
        timeframe,
        '-o',
        'historicalData',
      ],
      projectRoot
    );
  } else {
    await run(
      'bun',
      [
        './src/main.ts',
        'download-historical-binance-data',
        '--parallel',
        '10',
        '-d',
        _startDate,
        _endDate,
        '-p',
        'usd-m',
        '-t',
        'klines',
        '-s',
        symbol,
        '-i',
        timeframe,
        '-o',
        'historicalData',
      ],
      projectRoot
    );
  }

  const historicalDir = path.join(projectRoot, 'historicalData');
  const finalCsvPath = path.join(historicalDir, `${symbol}.csv`);
  await rm(finalCsvPath, { force: true });

  const zipFiles = (await readdir(historicalDir)).filter((file) => file.endsWith('.zip'));
  for (const zip of zipFiles) {
    await run('unzip', ['-o', zip], historicalDir);
  }
  for (const zip of zipFiles) {
    await rm(path.join(historicalDir, zip), { force: true });
  }

  const partialCsvs = (await readdir(historicalDir))
    .filter((file) => file.startsWith(`${symbol}-${timeframe}-`) && file.endsWith('.csv'))
    .sort();

  if (partialCsvs.length === 0) {
    throw new Error(`No CSV parts found for ${symbol}-${timeframe}`);
  }

  const tempCsvPath = path.join(historicalDir, `${symbol}.new`);
  await rm(tempCsvPath, { force: true });

  for (const partial of partialCsvs) {
    await pipeline(
      createReadStream(path.join(historicalDir, partial)),
      createWriteStream(tempCsvPath, { flags: 'a' })
    );
  }

  await Promise.all(partialCsvs.map((file) => rm(path.join(historicalDir, file), { force: true })));
  await rename(tempCsvPath, finalCsvPath);

  const csvRelativePath = path.join('historicalData', `${symbol}.csv`);
  if (config.general.isBinary) {
    // Take current binary name
    const currentBinary = process.execPath;
    await run(currentBinary, ['normalize-historical-data', csvRelativePath], projectRoot);
    await run(currentBinary, ['load-klines', csvRelativePath], projectRoot);
  } else {
    await run('bun', ['src/main.ts', 'normalize-historical-data', csvRelativePath], projectRoot);
    await run('bun', ['src/main.ts', 'load-klines', csvRelativePath], projectRoot);
  }
}
