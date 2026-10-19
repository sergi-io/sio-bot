import ansis from 'ansis';
import type { ALXKline } from '@/domain/ALXKline';
import { ALXTimeFramesMsMap, type ALXTimeFrame } from '@/domain/ALXTimeFrame';
import { NexusAggrSocketClient } from '@/exchanges/NexusAggrSocketClient';
import { NexusQuerySocketClient } from '@/exchanges/NexusQuerySocketClient';
import { registerGracefulShutdown } from '@/utils/gracefulShutdown';

type DashboardEvent = {
  atMs: number;
  message: string;
};

type DashboardConfig = {
  symbol: string;
  timeframe: ALXTimeFrame;
  historyLimit?: number;
};

const DEFAULT_HISTORY_LIMIT = 40;
const MAX_EVENT_LINES = 20;
const MAX_RECENT_KLINE_LINES = 20;
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1B\[[0-9;]*m/g;

function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString('en-GB', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatNumber(value: number, digits = 4): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatPrice(value: number): string {
  return formatNumber(value, 6);
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatSignedNumber(value: number, digits = 3): string {
  return `${value >= 0 ? '+' : ''}${formatNumber(value, digits)}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function getVisibleLength(text: string): number {
  return text.replace(ANSI_ESCAPE_PATTERN, '').length;
}

function padLine(text: string, width: number): string {
  const visibleLength = getVisibleLength(text);
  if (visibleLength >= width) {
    return text;
  }
  return `${text}${' '.repeat(width - visibleLength)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createCandleChart(
  klines: ALXKline[],
  width: number,
  activeTimestamp: number | null,
  progressRatio: number
): string[] {
  const chartHeight = 10;
  const maxCandlesThatFit = Math.max(8, Math.floor((width - 16) / 2));
  const visibleKlines = klines.slice(-Math.min(klines.length, maxCandlesThatFit));
  if (visibleKlines.length === 0) {
    return [padLine('No chart data available.', width)];
  }

  let minPrice = Number.POSITIVE_INFINITY;
  let maxPrice = Number.NEGATIVE_INFINITY;
  for (const kline of visibleKlines) {
    minPrice = Math.min(minPrice, kline.low);
    maxPrice = Math.max(maxPrice, kline.high);
  }

  const range = Math.max(maxPrice - minPrice, Number.EPSILON);
  const chartWidth = visibleKlines.length * 2 - 1;
  const grid = Array.from({ length: chartHeight }, () => Array(chartWidth).fill(' '));

  const priceToRow = (price: number): number => {
    const normalized = (price - minPrice) / range;
    return clamp(chartHeight - 1 - Math.round(normalized * (chartHeight - 1)), 0, chartHeight - 1);
  };

  visibleKlines.forEach((kline, index) => {
    const col = index * 2;
    const highRow = priceToRow(kline.high);
    const lowRow = priceToRow(kline.low);
    const openRow = priceToRow(kline.open);
    const closeRow = priceToRow(kline.close);
    const bodyTop = Math.min(openRow, closeRow);
    const bodyBottom = Math.max(openRow, closeRow);
    const isBullish = kline.close >= kline.open;
    const wickGlyph = isBullish ? ansis.green('│') : ansis.red('│');
    const bodyGlyph = isBullish ? ansis.green('█') : ansis.red('▓');

    for (let row = highRow; row <= lowRow; row += 1) {
      const gridRow = grid[row];
      if (gridRow) {
        gridRow[col] = wickGlyph;
      }
    }

    for (let row = bodyTop; row <= bodyBottom; row += 1) {
      const gridRow = grid[row];
      if (gridRow) {
        gridRow[col] = bodyGlyph;
      }
    }
  });

  const chartLines = grid.map((row, index) => {
    const price = maxPrice - (range * index) / (chartHeight - 1);
    return `${formatPrice(price).padStart(12, ' ')} │ ${row.join('')}`;
  });

  const baseAxis = `${' '.repeat(12)} └${'─'.repeat(chartWidth + 1)}`;
  const labelChars = Array(chartWidth).fill(' ');
  visibleKlines.forEach((kline, index) => {
    const col = index * 2;
    const label = kline.timestamp === activeTimestamp ? '●' : kline.type === 'full' ? '●' : '◌';
    labelChars[col] = label;
  });

  const progressCol =
    activeTimestamp !== null
      ? visibleKlines.findIndex((kline) => kline.timestamp === activeTimestamp) * 2
      : -1;
  if (progressCol >= 0) {
    labelChars[progressCol] = progressRatio >= 1 ? '◆' : '◉';
  }

  const labelsLine = `${' '.repeat(12)}   ${labelChars.join('')}`;
  const footer = padLine(
    `Chart range ${formatPrice(minPrice)} - ${formatPrice(maxPrice)}  Active progress ${Math.round(progressRatio * 100)}%`,
    width
  );

  return [
    ...chartLines.map((line) => padLine(line, width)),
    padLine(baseAxis, width),
    padLine(labelsLine, width),
    footer,
  ];
}

export class NexusTerminalDashboard {
  private readonly symbol: string;
  private readonly timeframe: ALXTimeFrame;
  private readonly historyLimit: number;
  private readonly queryClient = new NexusQuerySocketClient();
  private readonly aggrClient = new NexusAggrSocketClient();
  private readonly events: DashboardEvent[] = [];
  private readonly klines: ALXKline[] = [];
  private lastKlineAtMs: number | null = null;
  private lastMessageType: ALXKline['type'] | null = null;
  private messageCount = 0;
  private renderTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupRegistered = false;
  private disposed = false;
  private lastRenderedFrame = '';

  constructor({ symbol, timeframe, historyLimit = DEFAULT_HISTORY_LIMIT }: DashboardConfig) {
    this.symbol = symbol;
    this.timeframe = timeframe;
    this.historyLimit = historyLimit;
  }

  async run(): Promise<void> {
    this.addEvent(`Loading recent Nexus klines for ${this.symbol} ${this.timeframe}`);
    const initialKlines = await this.queryClient.query({
      queryType: 'last',
      pair: this.symbol,
      timeframes: [this.timeframe],
      limit: this.historyLimit,
    });

    for (const kline of initialKlines) {
      this.ingestKline(kline, false);
    }

    this.registerCleanup();
    this.render();
    this.renderTimer = setInterval(() => this.render(), 250);

    await this.aggrClient.connect();
    this.addEvent(`Connected to Nexus aggregate socket`);
    this.aggrClient.subscribe(this.symbol, [this.timeframe], async (kline) => {
      if (kline.pair !== this.symbol || kline.timeframe !== this.timeframe) {
        return;
      }
      this.ingestKline(kline, true);
    });

    this.render();

    await new Promise<void>(() => {});
  }

  private registerCleanup(): void {
    if (this.cleanupRegistered) {
      return;
    }
    this.cleanupRegistered = true;

    registerGracefulShutdown(async () => {
      this.dispose();
      process.stdout.write('\n');
    });
  }

  private dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }

    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[?25h\x1b[0m');
    }

    this.aggrClient.disconnect();
  }

  private ingestKline(kline: ALXKline, addLiveEvent: boolean): void {
    const lastKline = this.klines.at(-1);
    if (!lastKline || kline.timestamp > lastKline.timestamp) {
      this.klines.push(kline);
    } else if (kline.timestamp === lastKline.timestamp) {
      this.klines[this.klines.length - 1] = kline;
    } else {
      const existingIndex = this.klines.findIndex((item) => item.timestamp === kline.timestamp);
      if (existingIndex >= 0) {
        this.klines[existingIndex] = kline;
      }
    }

    while (this.klines.length > this.historyLimit) {
      this.klines.shift();
    }

    this.lastKlineAtMs = Date.now();
    this.lastMessageType = kline.type;
    this.messageCount += 1;

    if (addLiveEvent) {
      const volumeDelta = kline.buyVolume - kline.sellVolume;
      this.addEvent(
        `${kline.type.toUpperCase()} ${formatTimestamp(kline.timestamp)} O:${formatPrice(kline.open)} ` +
          `H:${formatPrice(kline.high)} L:${formatPrice(kline.low)} C:${formatPrice(kline.close)} ` +
          `ΔV:${formatSignedNumber(volumeDelta, 3)}`
      );
      this.render();
    }
  }

  private addEvent(message: string): void {
    this.events.unshift({ atMs: Date.now(), message });
    if (this.events.length > MAX_EVENT_LINES) {
      this.events.length = MAX_EVENT_LINES;
    }
  }

  private render(): void {
    if (!process.stdout.isTTY) {
      return;
    }

    const width = Math.max(process.stdout.columns || 100, 80);
    const height = Math.max(process.stdout.rows || 30, 20);
    const divider = ansis.gray('─'.repeat(width));
    const lastKline = this.klines.at(-1) ?? null;
    const previousClosedKline =
      this.klines.length >= 2
        ? (this.klines.at(lastKline?.type === 'delta' ? -2 : -1) ?? null)
        : lastKline?.type === 'full'
          ? lastKline
          : null;

    const candleChange =
      lastKline && lastKline.open !== 0
        ? ((lastKline.close - lastKline.open) / lastKline.open) * 100
        : 0;
    const colorizeChange = candleChange >= 0 ? ansis.green : ansis.red;
    const volumeDelta = lastKline ? lastKline.buyVolume - lastKline.sellVolume : 0;
    const volumeDeltaStyle = volumeDelta >= 0 ? ansis.green : ansis.red;
    const timeframeMs = ALXTimeFramesMsMap[this.timeframe];
    const progressRatio = lastKline
      ? Math.min(1, Math.max(0, (Date.now() - lastKline.timestamp) / timeframeMs))
      : 0;
    const progressBlocks = Math.round(progressRatio * 24);
    const progressBar = `${'█'.repeat(progressBlocks)}${'░'.repeat(24 - progressBlocks)}`;
    const chartLines = createCandleChart(
      this.klines,
      width,
      lastKline?.timestamp ?? null,
      progressRatio
    );
    const recentRows = this.klines
      .slice()
      .reverse()
      .map((kline) => {
        const change = kline.open !== 0 ? ((kline.close - kline.open) / kline.open) * 100 : 0;
        const style = change >= 0 ? ansis.green : ansis.red;
        const volumeDelta = kline.buyVolume - kline.sellVolume;
        const volumeDeltaStyle = volumeDelta >= 0 ? ansis.green : ansis.red;
        return padLine(
          [
            formatTimestamp(kline.timestamp),
            kline.type.toUpperCase().padEnd(5, ' '),
            `O ${formatPrice(kline.open)}`,
            `H ${formatPrice(kline.high)}`,
            `L ${formatPrice(kline.low)}`,
            `C ${formatPrice(kline.close)}`,
            style(formatPercent(change)),
            `Trades ${kline.tradeCount}`,
            `Delta ${volumeDeltaStyle(formatSignedNumber(volumeDelta, 3))}`,
          ].join('  '),
          width
        );
      });
    const headerLines = [
      ansis.cyan.bold(`NEXUS REALTIME DASHBOARD  ${this.symbol}  ${this.timeframe}`),
      divider,
      padLine(
        [
          `Last message: ${this.lastMessageType?.toUpperCase() ?? '-'}`,
          `Messages: ${this.messageCount.toLocaleString()}`,
          `Socket: ${this.aggrClient.isConnected() ? ansis.green('CONNECTED') : ansis.red('DISCONNECTED')}`,
          `Updated: ${this.lastKlineAtMs ? formatDuration(Date.now() - this.lastKlineAtMs) + ' ago' : '-'}`,
        ].join('  |  '),
        width
      ),
      divider,
      padLine(
        `Current candle: ${lastKline ? formatTimestamp(lastKline.timestamp) : '-'}  ` +
          `Progress ${progressBar} ${Math.round(progressRatio * 100)}%`,
        width
      ),
      padLine(
        `OHLC ${lastKline ? `${formatPrice(lastKline.open)} / ${formatPrice(lastKline.high)} / ${formatPrice(lastKline.low)} / ${formatPrice(lastKline.close)}` : '-'}`,
        width
      ),
      padLine(
        `Flow ${lastKline ? `Delta ${volumeDeltaStyle(formatSignedNumber(volumeDelta, 3))}  CostDelta ${formatSignedNumber(lastKline.buyCost - lastKline.sellCost, 2)}` : '-'}`,
        width
      ),
      padLine(
        `Liq ${lastKline ? `BuyVol ${formatNumber(lastKline.liqBuyVolume, 3)}  SellVol ${formatNumber(lastKline.liqSellVolume, 3)}  LiqCount ${lastKline.liqCount}` : '-'}`,
        width
      ),
      padLine(
        `Change ${lastKline ? colorizeChange(formatPercent(candleChange)) : '-'}  ` +
          `TradeCount ${lastKline?.tradeCount ?? '-'}  ` +
          `Last closed ${previousClosedKline ? formatTimestamp(previousClosedKline.timestamp) : '-'}`,
        width
      ),
      divider,
      ansis.cyan.bold('Candle Chart'),
      ...chartLines,
    ];

    const staticFooterLines = 6;
    const availableBodyRows = Math.max(2, height - headerLines.length - staticFooterLines);
    const preferredRecentRows = Math.min(MAX_RECENT_KLINE_LINES, recentRows.length);
    const preferredEventRows = Math.min(MAX_EVENT_LINES, this.events.length);
    const desiredRecentRows = Math.max(1, Math.ceil(availableBodyRows / 2));
    const recentRowCount = Math.min(preferredRecentRows, desiredRecentRows);
    const remainingRows = Math.max(1, availableBodyRows - recentRowCount);
    const eventRowCount = Math.min(MAX_EVENT_LINES, Math.max(preferredEventRows, 1), remainingRows);

    const visibleRecentRows = recentRows.slice(0, recentRowCount);
    const eventRows = this.events
      .slice(0, eventRowCount)
      .map((event) =>
        padLine(`${ansis.gray(formatTimestamp(event.atMs))}  ${event.message}`, width)
      );

    const lines = [
      ...headerLines,
      divider,
      ansis.cyan.bold(`Recent Klines (${visibleRecentRows.length}/${MAX_RECENT_KLINE_LINES})`),
      ...(visibleRecentRows.length > 0
        ? visibleRecentRows
        : [padLine('No kline data received yet.', width)]),
      divider,
      ansis.cyan.bold(`Event Feed (${eventRows.length}/${MAX_EVENT_LINES})`),
      ...(eventRows.length > 0 ? eventRows : [padLine('Waiting for Nexus output...', width)]),
      divider,
      ansis.gray('Press Ctrl+C to exit'),
    ];

    const frame = `${lines.join('\n')}\x1b[J`;
    if (frame === this.lastRenderedFrame) {
      return;
    }

    this.lastRenderedFrame = frame;
    process.stdout.write('\x1b[?25l\x1b[H');
    process.stdout.write(frame);
  }
}
