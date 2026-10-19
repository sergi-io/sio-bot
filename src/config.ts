import path from 'path';
import { parseCsvNumberList } from '@/utils/parseCsvNumberList';

// When running the packaged binary, resolve paths from the current working directory
// so the executable can be relocated alongside its config files.
const ROOT_DIR =
  process.env.SIOBOT_IS_BINARY === 'true' ? process.cwd() : path.resolve(__dirname, '..');

export const config = {
  general: {
    isBinary: /true/i.test(process.env.SIOBOT_IS_BINARY ?? 'false'),
    bunxPath: process.env.SIOBOT_BUNX_PATH ?? 'bunx',
    env: process.env.SIOBOT_ENV ?? 'prod',
    get isDevEnv() {
      return this.env === 'dev';
    },
    get isProdEnv() {
      return this.env === 'prod';
    },
    projectName: process.env.SIOBOT_PROJECT_NAME ?? '<Project Name>',
    environment: process.env.NODE_ENV ?? 'development', // this could be development or prod
    showInitBanner: /true/i.test(process.env.SIOBOT_SHOW_INIT_BANNER ?? 'false'),
    backTestReportPath: path.resolve(ROOT_DIR, 'tmp', 'backtestReport.html'),
    botConfigFilePath:
      process.env.SIOBOT_INITIAL_BOT_CONFIG_FILE_PATH ?? path.resolve(ROOT_DIR, 'bot-config.json'),
    optimizedBotConfigFilePath:
      process.env.SIOBOT_INITIAL_BOT_CONFIG_FILE_PATH ??
      path.resolve(ROOT_DIR, 'bot-config-optimized.run'),
  },
  log: {
    enabled: /true/i.test(process.env.SIOBOT_LOG_ENABLED ?? 'false'),
    level: process.env.SIOBOT_LOG_LEVEL ?? 'warn',
    dir: process.env.SIOBOT_LOG_DIR ?? path.resolve(ROOT_DIR, 'logs'),
    writeToFiles: /true/i.test(process.env.SIOBOT_WRITE_LOG_TO_FILES ?? 'false'),
  },
  notifications: {
    enabled: /true/i.test(process.env.SIOBOT_NOTIFICATIONS_ENABLED ?? 'false'),
    telegramBotToken: process.env.SIOBOT_TELEGRAM_BOT_TOKEN ?? '',
    telegramAllowedUserIds: parseCsvNumberList(process.env.SIOBOT_TELEGRAM_ALLOWED_USER_IDS),
    telegramBbwChannelId: Number(process.env.SIOBOT_TELEGRAM_BBW_CHANNEL_ID ?? 0),
  },
  exchanges: {
    liveExchange: process.env.SIOBOT_EXCHANGE_ID ?? 'phemex',
    phemex: {
      apiId: process.env.SIOBOT_PHEMEX_API_ID ?? '',
      apiSecret: process.env.SIOBOT_PHEMEX_API_SECRET ?? '',
    },
    bitget: {
      apiKey: process.env.SIOBOT_BITGET_API_KEY ?? '',
      apiSecret: process.env.SIOBOT_BITGET_API_SECRET ?? '',
      password: process.env.SIOBOT_BITGET_PASSWORD ?? '',
      enableTestnet: /true/i.test(process.env.SIOBOT_BITGET_TESTNET_ENABLED ?? 'false'),
    },
  },
  paperTrade: {
    enabled: /true/i.test(process.env.SIOBOT_PAPER_TRADE_ENABLED ?? 'false'),
    initialBalance: Number(process.env.SIOBOT_PAPER_TRADE_INITIAL_BALANCE ?? 1000),
  },
  backTest: {
    startDate: process.env.SIOBOT_BACK_TEST_DATE_START ?? '2025-01-01',
    endDate: process.env.SIOBOT_BACK_TEST_DATE_END ?? '2025-01-30',
    initialBalance: Number(process.env.SIOBOT_BACK_TEST_INITIAL_BALANCE ?? 1000),
  },
  configOptimizer: {
    runEverySeconds: Number(process.env.SIOBOT_RUN_CONFIG_OPTIMIZER_EVERY_SECONDS ?? -1),
    runAfterEveryTrade: /true/i.test(
      process.env.SIOBOT_RUN_CONFIG_OPTIMIZER_AFTER_EVERY_TRADE ?? 'false'
    ),
    runAtStartup: /true/i.test(process.env.SIOBOT_RUN_CONFIG_OPTIMIZER_AT_STARTUP ?? 'false'),
  },
  journal: {
    enabled: /true/i.test(process.env.SIOBOT_JOURNAL_ENABLED ?? 'true'),
    dir: process.env.SIOBOT_JOURNAL_DIR ?? path.resolve(ROOT_DIR, 'outputs', 'journal'),
  },
  frontend: {
    enabled: /true/i.test(process.env.SIOBOT_FRONTEND_ENABLED ?? 'false'),
    port: Number(process.env.SIOBOT_FRONTEND_PORT ?? 8787),
  },
  nexus: {
    aggrSocketPath: process.env.SIOBOT_NEXUS_AGGR_SOCKET_PATH ?? '/tmp/sio-nexus-aggr.sock',
    controlUnixSocketPath:
      process.env.SIOBOT_NEXUS_CONTROL_SOCKET_PATH ?? '/tmp/sio-nexus-control.sock',
    queryUnixSocketPath: process.env.SIOBOT_NEXUS_QUERY_SOCKET_PATH ?? '/tmp/sio-nexus-query.sock',
    scannerUnixSocketPath:
      process.env.SIOBOT_NEXUS_SCANNER_SOCKET_PATH ?? '/tmp/sio-nexus-scanner.sock',
  },
  defaults: {
    fees: {
      makerRate: Number(process.env.SIOBOT_EXCHANGE_DEFAULT_MAKER_FEE ?? 0.01),
      takerRate: Number(process.env.SIOBOT_EXCHANGE_DEFAULT_TAKER_FEE ?? 0.06),
      fundingRate: Number(process.env.SIOBOT_EXCHANGE_DEFAULT_FUNDING_RATE ?? 0.01),
    },
    buffer: {
      size: 500,
    },
  },
};
