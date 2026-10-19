import fs from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';
import { Command, Option } from 'commander';
import ora from 'ora';
import logSymbols from 'log-symbols';
import { generateDates, getList } from './utils.js';
import { byDayRegex, byMonthRegex } from './validateDateRegex.js';
import { IncorrectParamError } from './customErrors.js';
import {
  datatypesWithInterval,
  futuresDailyDataTypes,
  futuresMonthlyDataTypes,
  intervalList,
  optionsDataTypes,
  products,
  spotDataTypes,
} from './lists.js';

const DOWNLOAD_TIMEOUT_MS = 20000;
const CHECKSUM_TIMEOUT_MS = 10000;

export type GetHistoricalDataOptions = {
  date?: string[];
  product?: string;
  dataType?: string;
  symbols?: string[];
  intervals?: string[] | null;
  outputPath?: string;
  parallel: number;
  validateParams: boolean;
};

export function createDownloadHistoricalBinanceDataCommand(): Command {
  const command = new Command('download-historical-binance-data');

  command
    .description('Download historical market data from Binance Data Service')
    .option(
      '-d, --date <date...>',
      "date can be provided in one of two formats: 'YYYY-MM' to get monthly data; 'YYYY-MM-DD' to get daily data. To get data for a range provide two dates of the same format separated by a space (e.g., '2024-01 2024-08')"
    )
    .option('-p, --product <product>', 'should be one of: ' + getList(products))
    .option('-t, --data-type <type>', "data type (e.g., 'klines')")
    .option(
      '-s, --symbols <symbols...>',
      "one or more symbols separated by a space (e.g., 'btcusdt')"
    )
    .option(
      '-i, --intervals <intervals...>',
      'one or more intervals separated by a space. Accepted intervals: ' + getList(intervalList)
    )
    .option(
      '-o, --output-path <path>',
      'path to save the data to. Current directory is used by default'
    )
    .addOption(
      new Option('-P, --parallel <num>', 'number of files to download at a time')
        .argParser((val) => {
          const parsed = parseInt(val, 10);
          if (!Number.isInteger(parsed) || parsed < 1) {
            throw new IncorrectParamError('--parallel (-P) must be a number (1 or greater)');
          }
          return parsed;
        })
        .default(5)
    )
    .option(
      '--no-validate-params',
      "do not validate 'product', 'data type', 'symbols' and 'intervals'. Only use this if the API has changed"
    )
    .action(async (params: GetHistoricalDataOptions) => {
      try {
        if (!params.date || !Array.isArray(params.date) || params.date.length === 0) {
          throw new IncorrectParamError('--date (-d) must be provided');
        }
        if (params.date.length > 2) {
          throw new IncorrectParamError(
            'only one or two date strings expected, received: ' + getList(params.date)
          );
        }

        const [startDate, endDate] = params.date as [string, string?];
        let byDay = false;
        if (byDayRegex.test(startDate)) {
          byDay = true;
        } else if (!byMonthRegex.test(startDate)) {
          throw new IncorrectParamError(
            "incorrect start date: '" +
              startDate +
              "'. Accepted formats: monthly (YYYY-MM), daily (YYYY-MM-DD)"
          );
        }

        if (endDate && (byDay ? !byDayRegex.test(endDate) : !byMonthRegex.test(endDate))) {
          throw new IncorrectParamError(
            "incorrect end date: '" +
              endDate +
              "'. Both start and end date should either be in monthly (YYYY-MM) or daily (YYYY-MM-DD) format"
          );
        }

        if (endDate && +new Date(startDate) >= +new Date(endDate)) {
          throw new IncorrectParamError('end date should be greater than start date');
        }

        if (params.validateParams) {
          if (!params.product || !products.includes(params.product)) {
            throw new IncorrectParamError('--product (-p) should be one of: ' + getList(products));
          }

          if (params.product === 'spot') {
            if (!params.dataType || !spotDataTypes.includes(params.dataType)) {
              throw new IncorrectParamError(
                "--data-type (-t) for 'spot' should be one of: " + getList(spotDataTypes)
              );
            }
          } else if (params.product === 'option') {
            if (!params.dataType || !optionsDataTypes.includes(params.dataType)) {
              throw new IncorrectParamError(
                "--data-type (-t) for 'option' should be one of: " + getList(optionsDataTypes)
              );
            }
            if (!byDay) {
              throw new IncorrectParamError("only daily data is available for 'option'");
            }
          } else {
            if (byDay && (!params.dataType || !futuresDailyDataTypes.includes(params.dataType))) {
              throw new IncorrectParamError(
                "--data-type (-t) for daily futures data ('usd-m' or 'coin-m') should be one of: " +
                  getList(futuresDailyDataTypes)
              );
            }
            if (
              !byDay &&
              (!params.dataType || !futuresMonthlyDataTypes.includes(params.dataType))
            ) {
              throw new IncorrectParamError(
                "--data-type (-t) for monthly futures data ('usd-m' or 'coin-m') should be one of: " +
                  getList(futuresMonthlyDataTypes)
              );
            }
          }

          if (!params.symbols || !Array.isArray(params.symbols) || params.symbols.length === 0) {
            throw new IncorrectParamError("at least one symbol must be provided (e.g., 'btcusdt')");
          }
          params.symbols = params.symbols.map((sym) => sym.toUpperCase());

          if (datatypesWithInterval.includes(params.dataType ?? '')) {
            if (
              !params.intervals ||
              !Array.isArray(params.intervals) ||
              params.intervals.length === 0
            ) {
              throw new IncorrectParamError(
                `at least one 'interval' must be provided for '${params.dataType}' data`
              );
            }
            const incorrectIntervals = params.intervals.filter(
              (interval) => !intervalList.includes(interval)
            );
            if (incorrectIntervals.length) {
              throw new IncorrectParamError(
                'incorrect intervals provided: ' +
                  getList(incorrectIntervals) +
                  '. Accepted intervals: ' +
                  getList(intervalList)
              );
            }
          } else {
            params.intervals = null;
          }
        }

        const outputPath = resolve(params.outputPath ?? '.');
        try {
          await fs.access(outputPath, constants.W_OK);
          if (!(await fs.lstat(outputPath)).isDirectory()) {
            throw new IncorrectParamError('--output-path (-o) should be a directory');
          }
        } catch (e: any) {
          if (e.code && e.code === 'ENOENT') {
            console.log('Warning: output directory does not exist');
            try {
              const dir = await fs.mkdir(outputPath, { recursive: true });
              console.log("Created '" + dir + "'");
            } catch (er: any) {
              if (er.code && er.code === 'EACCES') {
                throw new IncorrectParamError(
                  "could not create directory '" + outputPath + "'. Permission denied"
                );
              } else {
                throw er;
              }
            }
          } else if (e.code && e.code === 'EACCES') {
            throw new IncorrectParamError(
              "do not have permission to write to '" + outputPath + "'"
            );
          } else {
            throw e;
          }
        }

        const dates = generateDates(byDay, startDate, endDate);
        const urls: string[] = [];
        for (const symbol of params.symbols ?? []) {
          for (const interval of params.intervals ?? [null]) {
            for (const date of dates) {
              let url = 'https://data.binance.vision/data';
              function addToPath(str: string) {
                url += '/' + str;
              }
              addToPath(
                params.product === 'usd-m'
                  ? 'futures/um'
                  : params.product === 'coin-m'
                    ? 'futures/cm'
                    : (params.product ?? '')
              );
              addToPath(byDay ? 'daily' : 'monthly');
              addToPath(params.dataType ?? '');
              addToPath(symbol);
              if (interval) {
                addToPath(interval);
                addToPath(`${symbol}-${interval}-${date}.zip`);
              } else {
                addToPath(`${symbol}-${params.dataType}-${date}.zip`);
              }
              urls.push(url);
            }
          }
        }

        const requestCount = urls.length;
        const requestCountWidth = requestCount.toString().length;
        const progressCount = {
          success: 0,
          noData: 0,
          fail: 0,
          done() {
            return this.success + this.noData + this.fail;
          },
        };
        const spinner = ora();

        function printResult(symbol: string, name: string, error?: string) {
          spinner.stop();
          if (symbol === logSymbols.success) {
            progressCount.success++;
          } else if (symbol === logSymbols.warning) {
            progressCount.noData++;
          } else {
            progressCount.fail++;
          }
          const doneCount = progressCount.done();
          console.log(
            `[${doneCount.toString().padStart(requestCountWidth, ' ')}/${requestCount}] ${name} ${symbol}${
              error ? ' (' + error + ')' : ''
            }`
          );
          if (doneCount < requestCount) {
            spinner.start();
          }
        }

        const promises: Promise<void>[] = [];
        let activeWorkers = 0;

        function checkIfFinished() {
          // Only finish when all workers are done AND there are no more URLs to process
          if (activeWorkers === 0 && urls.length === 0 && progressCount.done() === requestCount) {
            if (progressCount.success === requestCount) {
              console.log('DONE');
            } else {
              let result = `Downloaded: ${progressCount.success}/${requestCount} files`;
              if (progressCount.noData) {
                result += `; not found: ${progressCount.noData}/${requestCount} files`;
              }
              if (progressCount.fail) {
                result += `; failed to complete: ${progressCount.fail}/${requestCount} files`;
              }
              console.log(result);
              if (progressCount.success === 0) {
                process.exitCode = 1;
              }
            }
          }
        }

        function requestData(url: string) {
          const fileNameMatch = url.match(/[^/]*\.zip$/);
          const fileName = fileNameMatch ? fileNameMatch[0] : 'unknown.zip';
          const fileVerified = join(outputPath, fileName);
          const fileUnverified = fileVerified.replace(/\.zip$/, '_UNVERIFIED.zip');

          const sha256 = crypto.createHash('sha256');

          function getChecksum() {
            return new Promise<string>((resolve, reject) => {
              try {
                const req = https.get(url + '.CHECKSUM', (res) => {
                  let checksumText = '';
                  res.on('error', reject);
                  res.on('end', () => {
                    const checksum = checksumText.slice(0, 64);
                    if (/^[0-9a-f]{64}$/.test(checksum)) {
                      resolve(checksum);
                    } else {
                      reject(new Error('invalid checksum response'));
                    }
                  });
                  res.on('data', (chunk) => {
                    checksumText += chunk.toString();
                  });
                });
                req.on('error', reject);
                req.setTimeout(CHECKSUM_TIMEOUT_MS, () => {
                  req.destroy(new Error('checksum request timeout'));
                });
              } catch (e) {
                reject(e as Error);
              }
            });
          }

          return new Promise<void>((resolve) => {
            try {
              const req = https.get(url, (res) => {
                if (res.headers['content-type'] && res.headers['content-type'].includes('xml')) {
                  res.destroy();
                  printResult(logSymbols.warning, fileName, 'no data');
                  return resolve();
                }

                res.on('error', (e) => {
                  printResult(
                    logSymbols.error,
                    fileName,
                    getErrorString('error while loading data', e)
                  );
                  resolve();
                });

                res.on('end', async () => {
                  try {
                    const checksum = await getChecksum();
                    if (checksum === sha256.digest('hex')) {
                      await fs.rename(fileUnverified, fileVerified);
                      printResult(logSymbols.success, fileName);
                      resolve();
                    } else {
                      printResult(logSymbols.error, fileName, 'checksum does not match');
                      resolve();
                    }
                  } catch (e) {
                    printResult(
                      logSymbols.error,
                      fileName,
                      getErrorString('error fetching checksum', e)
                    );
                    resolve();
                  }
                });

                res
                  .pipe(new PassThrough().on('data', (chunk) => sha256.update(chunk)))
                  .pipe(createWriteStream(fileUnverified));
              });

              req.on('error', errorConnecting);
              req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
                req.destroy(new Error('download request timeout'));
              });
            } catch (e) {
              errorConnecting(e as Error);
            }

            function errorConnecting(e: Error) {
              printResult(
                logSymbols.error,
                fileName,
                getErrorString('error establishing connection', e)
              );
              resolve();
            }
            function getErrorString(text: string, e: any) {
              return text + (e && e.message ? ` [${e.message}]` : '');
            }
          });
        }

        async function addToQueue() {
          const nextUrl = urls.shift();
          if (!nextUrl) {
            // No more URLs to process, this worker is done
            activeWorkers--;
            checkIfFinished();
            return;
          }
          const promise = requestData(nextUrl);
          promises.push(promise);
          await promise;
          // After completing a download, try to get another URL
          // If urls is empty, the recursive call will decrement activeWorkers
          await addToQueue();
        }

        console.log(
          "Saving to '" +
            outputPath +
            "'" +
            "\nDownloading '" +
            params.dataType +
            "' " +
            (byDay ? 'daily' : 'monthly') +
            ' data for ' +
            (params.symbols?.length ?? 0) +
            ' symbol(s)' +
            (params.intervals ? ' and ' + params.intervals.length + ' interval(s)' : '') +
            '\nTotal number of files to load: ' +
            requestCount
        );
        spinner.start();
        const workersToStart = Math.min(params.parallel, urls.length);
        activeWorkers = workersToStart;
        for (let i = 0; i < workersToStart; i++) {
          // Fire and forget to allow parallel downloads.
          void addToQueue();
        }
      } catch (e: any) {
        process.exitCode = 1;
        if (!e) {
          console.log('An unexpected error occurred. Exiting...');
        } else if (e instanceof Error) {
          if (e.name === 'IncorrectParamError') {
            console.log('Error: ' + e.message);
            process.exitCode = 2;
          } else {
            console.log(e.stack);
          }
        } else {
          console.log(e);
        }
      }
    });

  return command;
}
