import fs from 'fs';
import packageJson from '../package.json' with { type: 'json' };
import { config } from '@/config';
import { renderInitBanner } from '@/utils/banner';
import { getAvailableCpuCores } from './utils/cpuCores';
import { consoleLogger as logger } from './utils/logger';
import { PhemexExchange } from './exchanges/PhemexExchange/PhemexExchange';
import { BitgetExchange } from './exchanges/BitgetExchange/BitgetExchange';
import { BotConfig } from './siobot/BotConfig';
import { SioBot } from './siobot/SioBot';
import { Command, program } from 'commander';
import { BackTester, type BackTestConfig } from './backtester/BackTester';
import { ConfigOptimizer } from './backtester/configOptimizer/ConfigOptimizer';
import { sleep } from 'bun';
import { PaperTradeExchange } from './exchanges/PaperTradeExchange/PaperTradeExchange';
import ansis from 'ansis';
import { Telegram } from './comms/Telegram';
import { BotRunMode } from './siobot/constants';
import { normalizeHistoricalData } from './utils/klines/normalizeHistoricalData';
import { formatDateTimeFromMs, formatDurationMs } from './utils/date';
import { downloadHistoricalData } from './utils/klines/downloadHistoricalData';
import { createDownloadHistoricalBinanceDataCommand } from './utils/klines/downloadHistoricalBinanceData/downloadHistoricalBinanceDataCommand';
import { JournalGenerator } from './journal/JournalGenerator';
import { NexusQuerySocketClient, type NexusInfoResult } from './exchanges/NexusQuerySocketClient';
import type { ALXTimeFrame } from './domain/ALXTimeFrame';
import { resolveCliDateRange } from './utils/cliDateRange';

const { maxCores, minCores } = getAvailableCpuCores();
const APP_VERSION = packageJson.version;

function createLiveExchange(): PhemexExchange | BitgetExchange {
  switch (config.exchanges.liveExchange.toLowerCase()) {
    case 'phemex':
      logger.info(ansis.red.bold('Running in LIVE TRADE mode (using PhemexExchange)...'));
      return new PhemexExchange({
        apiKey: config.exchanges.phemex.apiId,
        secret: config.exchanges.phemex.apiSecret,
      });
    case 'bitget':
      logger.info(ansis.red.bold('Running in LIVE TRADE mode (using BitgetExchange)...'));
      return new BitgetExchange({
        apiKey: config.exchanges.bitget.apiKey,
        secret: config.exchanges.bitget.apiSecret,
        password: config.exchanges.bitget.password,
        enableTestnet: config.exchanges.bitget.enableTestnet,
      });
    default:
      throw new Error(
        `Unsupported live exchange "${config.exchanges.liveExchange}". Expected "phemex" or "bitget".`
      );
  }
}

function formatDateMs(timestampMs: number | null): string {
  if (timestampMs === null) {
    return '-';
  }
  return formatDateTimeFromMs(timestampMs);
}

function formatRangeGapMs(startDateMs: number, endDateMs: number): string {
  return formatDurationMs(endDateMs - startDateMs);
}

function printNexusInfoTable(info: NexusInfoResult): void {
  const totalKlines = info.ranges.reduce((acc, item) => acc + item.count, 0);
  const totalNoGapRanges = info.ranges.reduce((acc, item) => acc + item.noGapRanges.length, 0);

  console.log(ansis.cyan.bold('\nNEXUS INFO'));
  console.log(`Socket: ${config.nexus.queryUnixSocketPath}`);
  console.log(`Tables: ${info.ranges.length.toLocaleString()}`);
  console.log(`Timeframes: ${info.timeframes.length.toLocaleString()}`);
  console.log(`Total Klines: ${totalKlines.toLocaleString()}`);
  console.log(`No-gap ranges: ${totalNoGapRanges.toLocaleString()}`);

  console.log(ansis.cyan.bold('\nTIMEFRAMES'));
  console.table(
    info.timeframes.map((item) => ({
      timeframe: item.timeframe,
      label: item.label,
      milliseconds: item.milliseconds.toLocaleString(),
    }))
  );

  console.log(ansis.cyan.bold('\nRANGES'));
  console.table(
    info.ranges.map((item) => ({
      table: item.tableName,
      pair: item.pair,
      timeframe: item.timeframe,
      startDate: formatDateMs(item.range.startDate),
      endDate: formatDateMs(item.range.endDate),
      count: item.count.toLocaleString(),
      noGapSegments: item.noGapRanges.length.toLocaleString(),
    }))
  );

  const noGapRows = info.ranges.flatMap((item) =>
    item.noGapRanges.map((range, index) => {
      const nextRange = item.noGapRanges[index + 1];

      return {
        table: item.tableName,
        pair: item.pair,
        timeframe: item.timeframe,
        segment: index + 1,
        startDate: formatDateMs(range.startDate),
        endDate: formatDateMs(range.endDate),
        timeGapToNext: nextRange ? formatRangeGapMs(range.endDate, nextRange.startDate) : '-',
        count: range.count.toLocaleString(),
      };
    })
  );

  console.log(ansis.cyan.bold('\nNO-GAP RANGES'));
  if (noGapRows.length === 0) {
    console.log('No no-gap ranges found.');
  } else {
    console.table(noGapRows);
  }
}

async function loadBotConfig(): Promise<BotConfig> {
  const botConfig = new BotConfig();

  if (!fs.existsSync(config.general.botConfigFilePath)) {
    logger.error(
      `❌ No bot configuration file found! Please create a bot configuration file at: ${config.general.botConfigFilePath}`
    );
    process.exit(1);
  }

  if (fs.existsSync(config.general.optimizedBotConfigFilePath)) {
    botConfig.loadFromFile(config.general.optimizedBotConfigFilePath);
    logger.info(`💾 Found optimized-bot-config.run - Loaded optimized bot configuration!`);
    await sleep(1000);
  } else {
    botConfig.loadFromFile(config.general.botConfigFilePath);
    logger.info(`💾 Found bot-config.json - Loaded initial bot configuration!`);
    await sleep(1000); // small delay to ensure log order
  }

  return botConfig;
}

async function runBotCommand({
  showIndicatorsInTerminal = false,
  preloadAllIndicators = false,
}: {
  showIndicatorsInTerminal?: boolean;
  preloadAllIndicators?: boolean;
} = {}): Promise<void> {
  if (config.general.showInitBanner) {
    renderInitBanner();
  }

  console.log(`💻 CPU cores to use: MAX - ${maxCores} | MIN - ${minCores}`);
  console.log(`📝 Logger: ${config.log.enabled ? 'ENABLED' : 'DISABLED'}`);
  if (config.log.enabled) {
    console.log(`🐛 Log level: ${config.log.level}`);
    console.log(`📂 Log folder: ${config.log.dir}`);
  }

  logger.info('Starting SIOBOT application...');

  if (config.notifications.enabled) {
    Telegram.startService();
  }

  let exchange = null;

  if (config.paperTrade.enabled) {
    logger.info(ansis.yellow.bold('Running in PAPER TRADE mode (using PaperTradeExchange)...'));
    exchange = new PaperTradeExchange();
    Telegram.sendMessage(`🤖 Bot started in PAPER TRADE mode (version ${APP_VERSION}).`);
  } else {
    exchange = createLiveExchange();
    Telegram.sendMessage(`🤖 Bot started in LIVE TRADE mode (version ${APP_VERSION}).`);
  }

  const botConfig = await loadBotConfig();

  const siobot = new SioBot({
    mode: config.paperTrade.enabled ? BotRunMode.PAPER_TRADE : BotRunMode.LIVE,
    botConfig,
    exchange,
  });

  if (preloadAllIndicators) {
    siobot.taManager.preloadAllSupportedIndicators();
  }

  Telegram.registerSioBot(siobot);

  await siobot.run();

  if (config.frontend.enabled) {
    const { WebSocketCommandCenterServer } = await import('./comms/WebSocketCommandCenterServer');
    const commandCenter = new WebSocketCommandCenterServer({ bot: siobot });
    Telegram.registerCommandCenter(commandCenter);
    await commandCenter.start();
    console.log(`Command Center: ${commandCenter.getUrl()}`);
  }

  if (showIndicatorsInTerminal) {
    const { IndicatorTerminalDashboard } = await import('./ta/IndicatorTerminalDashboard');
    const dashboard = new IndicatorTerminalDashboard({ bot: siobot });
    await siobot.pause({ persist: false });
    await dashboard.run();
  }
}

// Main execution
async function main(): Promise<void> {
  program
    .name('sio-bot')
    .description('SIOBOT Trading Bot Application')
    .version(APP_VERSION)
    .addCommand(
      new Command('version')
        .alias('versión')
        .description('Show the executable version')
        .action(() => {
          console.log(`sio-bot ${APP_VERSION}`);
        })
    )
    .addCommand(
      new Command('backtest')
        .description('Run the bot in backtest mode')
        .argument('[startDate]', 'Optional start date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)')
        .argument('[endDate]', 'Optional end date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)')
        .action(async (startDate?: string, endDate?: string) => {
          const botConfig = await loadBotConfig();
          logger.info('Running in backtest mode...');

          const { startTimestampMs, endTimestampMs } = resolveCliDateRange({
            startDate,
            endDate,
            defaultStartDate: config.backTest.startDate,
            defaultEndDate: config.backTest.endDate,
          });

          botConfig.backtestStartTimestampMs = startTimestampMs;
          botConfig.backtestEndTimestampMs = endTimestampMs;
          const backTestConfig: BackTestConfig = {
            initialBalance: config.backTest.initialBalance,
            botConfig,
            printReport: true,
            slowMotionFactor: 0,
          };

          const backTester = new BackTester(backTestConfig);
          await backTester.run();
          return;
        })
    )
    .addCommand(
      new Command('config-optimizer-brute-force')
        .description('Run the bot in config optimization mode (Brute Force)')
        .argument('[startDate]', 'Optional start date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)')
        .argument('[endDate]', 'Optional end date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)')
        .action(async (startDate?: string, endDate?: string) => {
          const botConfig = await loadBotConfig();
          logger.info('Running in config optimization mode (Brute Force)...');
          const { startTimestampMs, endTimestampMs } = resolveCliDateRange({
            startDate,
            endDate,
            defaultStartDate: config.backTest.startDate,
            defaultEndDate: config.backTest.endDate,
          });
          const configOptimizer = new ConfigOptimizer({
            maxWorkers: maxCores,
            botConfig,
            mode: 'bruteforce',
            walkForwardFolds: 0,
            startTimestampMs,
            endTimestampMs,
          });
          await configOptimizer.run();
          return;
        })
    )
    .addCommand(
      new Command('config-optimizer-genetic')
        .description('Run the bot in config optimization mode (Genetic Algorithm)')
        .argument('[startDate]', 'Optional start date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)')
        .argument('[endDate]', 'Optional end date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)')
        .option('--fast', 'Enable fast mode for genetic optimization', false)
        .action(async (startDate?: string, endDate?: string, options?: { fast?: boolean }) => {
          const botConfig = await loadBotConfig();
          logger.info('Running in config optimization mode (Genetic Algorithm)...');
          const { startTimestampMs, endTimestampMs } = resolveCliDateRange({
            startDate,
            endDate,
            defaultStartDate: config.backTest.startDate,
            defaultEndDate: config.backTest.endDate,
          });
          const configOptimizer = new ConfigOptimizer({
            maxWorkers: maxCores,
            botConfig,
            walkForwardFolds: options?.fast
              ? 0
              : botConfig.configOptimizerGenetic?.params.walkForwardFolds,
            runFast: options?.fast ?? false,
            mode: 'genetic',
            startTimestampMs,
            endTimestampMs,
          });
          await configOptimizer.run();
          return;
        })
    )
    .addCommand(
      new Command('normalize-historical-data')
        .description('Normalize historical data CSV file')
        .argument('<csv>', 'CSV file path')
        .action(async (csv: string) => {
          logger.info(`Starting in Historical Data Normalization mode...`);
          normalizeHistoricalData(csv);
          return;
        })
    )
    .addCommand(
      new Command('download-historical-data')
        .description('Download historical klines data from exchange')
        .argument('[startDate]', 'Optional start date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)')
        .argument('[endDate]', 'Optional end date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)')
        .action(async (startDate?: string, endDate?: string) => {
          logger.info(`Starting in Historical Data Downloader mode...`);
          await downloadHistoricalData(startDate, endDate);
          return;
        })
    )
    .addCommand(
      new Command('generate-journal')
        .description('Force generate the trading journal from position history')
        .action(async () => {
          logger.info('Generating trading journal...');
          const generator = new JournalGenerator();
          await generator.regenerate(true);
          logger.info(`Journal generated at ${config.journal.dir}/index.html`);
          return;
        })
    )
    .addCommand(
      new Command('nexus-info')
        .description('Fetch and print info from Nexus query socket')
        .option('--json', 'Print raw JSON instead of terminal tables', false)
        .action(async (options?: { json?: boolean }) => {
          logger.info('Fetching Nexus info from query socket...');
          const client = new NexusQuerySocketClient();
          const info = await client.queryInfo();
          if (options?.json) {
            console.log(JSON.stringify(info, null, 2));
          } else {
            printNexusInfoTable(info);
          }
          return;
        })
    )
    .addCommand(
      new Command('nexus-dashboard')
        .description('Render a realtime Nexus terminal dashboard for the trading timeframe')
        .option('--symbol <symbol>', 'Override the configured asset symbol')
        .option('--timeframe <timeframe>', 'Override the configured trading timeframe')
        .option('--history <count>', 'Number of recent klines to display', '40')
        .action(async (options?: { symbol?: string; timeframe?: string; history?: string }) => {
          const botConfig = await loadBotConfig();
          const symbol = options?.symbol ?? botConfig.assetSymbol;
          const timeframe = (options?.timeframe ?? botConfig.timeFrameToTrade) as ALXTimeFrame;
          const historyLimit = Number.parseInt(options?.history ?? '40', 10);

          if (!Number.isFinite(historyLimit) || historyLimit < 2) {
            throw new Error('The --history value must be an integer greater than or equal to 2.');
          }

          logger.info(
            `Starting Nexus realtime dashboard for ${symbol} on ${timeframe} (${historyLimit} klines)`
          );

          const { NexusTerminalDashboard } = await import('./exchanges/NexusTerminalDashboard');
          const dashboard = new NexusTerminalDashboard({
            symbol,
            timeframe,
            historyLimit,
          });
          await dashboard.run();
        })
    );

  program.addCommand(createDownloadHistoricalBinanceDataCommand());

  program.addCommand(
    new Command('run').description('Run the SioBot').action(async () => runBotCommand())
  );

  program.addCommand(
    new Command('indicator-dashboard')
      .description('Run the SioBot with a realtime terminal view of registered indicators')
      .action(async () =>
        runBotCommand({ showIndicatorsInTerminal: true, preloadAllIndicators: true })
      )
  );

  await program.parseAsync();
}
// Start the application
main().catch(console.error);
