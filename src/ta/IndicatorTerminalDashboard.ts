import blessed from 'blessed';
import type { Widgets } from 'blessed';
import type { SioBot } from '@/siobot/SioBot';
import { registerGracefulShutdown } from '@/utils/gracefulShutdown';

type IndicatorTerminalDashboardParams = {
  bot: SioBot;
  refreshMs?: number;
};

const DEFAULT_REFRESH_MS = 250;
const CARD_GAP = 1;
const CARD_MIN_WIDTH = 28;

function compactIndicatorId(id: string): string {
  return id
    .replace(/_(1s|10s|1m|5m|15m|30m|1h|4h|1d)_/g, ' @$1 ')
    .replace(/_[A-Z0-9]+USDT$/, '')
    .replace(/_/g, ' ');
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const absValue = Math.abs(value);
  const digits = absValue >= 1000 ? 2 : absValue >= 1 ? 4 : 8;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatTimestamp(timestampMs: number | null): string {
  if (timestampMs === null) {
    return '-';
  }

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

function formatIndicatorValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined) {
    return '-';
  }

  if (typeof value === 'number') {
    return formatNumber(value);
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 4).map((item) => formatIndicatorValue(item, depth + 1));
    const suffix = value.length > 4 ? ', …' : '';
    return `[${items.join(', ')}${suffix}]`;
  }

  if (typeof value === 'object') {
    if (depth >= 2) {
      return '{…}';
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .slice(0, 6)
      .map(([key, entryValue]) => `${key}: ${formatIndicatorValue(entryValue, depth + 1)}`);
    const suffix = Object.keys(value as Record<string, unknown>).length > 6 ? ', …' : '';
    return `{ ${entries.join(', ')}${suffix} }`;
  }

  return String(value);
}

function formatIndicatorValueLines(value: unknown, indent = 0): string[] {
  const indentation = ' '.repeat(indent);

  if (value === null || value === undefined) {
    return [`${indentation}-`];
  }

  if (
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    value instanceof Date
  ) {
    return [`${indentation}${formatIndicatorValue(value)}`];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${indentation}[]`];
    }

    return value.slice(0, 6).flatMap((item, index) => {
      const itemLines = formatIndicatorValueLines(item, indent + 2);
      const [firstLine = `${' '.repeat(indent + 2)}-`, ...rest] = itemLines;
      const marker = `${indentation}[${index}] `;
      const normalizedFirstLine = firstLine.startsWith(' '.repeat(indent + 2))
        ? firstLine.slice(indent + 2)
        : firstLine;
      const lines = [`${marker}${normalizedFirstLine}`];

      for (const line of rest) {
        lines.push(line);
      }

      return lines;
    });
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return [`${indentation}{}`];
    }

    const lines: string[] = [];
    for (const [key, entryValue] of entries.slice(0, 10)) {
      if (
        entryValue === null ||
        entryValue === undefined ||
        typeof entryValue === 'number' ||
        typeof entryValue === 'string' ||
        typeof entryValue === 'boolean'
      ) {
        lines.push(`${indentation}${key}: ${formatIndicatorValue(entryValue)}`);
        continue;
      }

      lines.push(`${indentation}${key}:`);
      lines.push(...formatIndicatorValueLines(entryValue, indent + 2));
    }

    if (entries.length > 10) {
      lines.push(`${indentation}…`);
    }

    return lines;
  }

  return [`${indentation}${String(value)}`];
}

function getColumnCount(width: number): number {
  if (width >= 220) {
    return 5;
  }

  if (width >= 180) {
    return 4;
  }

  if (width >= 120) {
    return 3;
  }

  if (width >= 90) {
    return 2;
  }

  return 1;
}

function computeCardWidth(screenWidth: number, columnCount: number): number {
  const available = screenWidth - 2 - CARD_GAP * (columnCount - 1);
  return Math.max(CARD_MIN_WIDTH, Math.floor(available / columnCount));
}

export class IndicatorTerminalDashboard {
  private readonly bot: SioBot;
  private readonly refreshMs: number;
  private readonly screen: Widgets.Screen;
  private readonly headerBox: Widgets.BoxElement;
  private readonly bodyBox: Widgets.BoxElement;
  private readonly footerBox: Widgets.BoxElement;
  private readonly cardBoxes = new Map<string, Widgets.BoxElement>();
  private renderTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupRegistered = false;
  private disposed = false;

  constructor({ bot, refreshMs = DEFAULT_REFRESH_MS }: IndicatorTerminalDashboardParams) {
    this.bot = bot;
    this.refreshMs = refreshMs;
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      dockBorders: true,
      title: 'SIOBOT Indicator Dashboard',
    });

    this.headerBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      tags: false,
      border: 'line',
      style: {
        border: { fg: 'cyan' },
      },
    });

    this.bodyBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '100%',
      bottom: 1,
      tags: false,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true,
      border: 'line',
      label: ' Indicators ',
      style: {
        border: { fg: 'white' },
        scrollbar: {
          bg: 'blue',
        },
      },
      scrollbar: {
        ch: ' ',
      },
    });

    this.footerBox = blessed.box({
      parent: this.screen,
      left: 0,
      bottom: 0,
      width: '100%',
      height: 1,
      tags: false,
      content: 'j/k scroll  PgUp/PgDn page  q exit',
    });
  }

  async run(): Promise<void> {
    this.registerCleanup();
    this.screen.key(['q', 'escape', 'C-c'], () => {
      this.dispose();
      process.exit(0);
    });
    this.screen.key(['j', 'down'], () => {
      this.bodyBox.scroll(1);
      this.screen.render();
    });
    this.screen.key(['k', 'up'], () => {
      this.bodyBox.scroll(-1);
      this.screen.render();
    });
    this.screen.key(['pageup'], () => {
      this.bodyBox.scroll(-10);
      this.screen.render();
    });
    this.screen.key(['pagedown'], () => {
      this.bodyBox.scroll(10);
      this.screen.render();
    });

    this.render();
    this.renderTimer = setInterval(() => this.render(), this.refreshMs);
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

    this.screen.destroy();
  }

  private render(): void {
    const snapshots = this.bot.taManager.getRegisteredIndicatorSnapshots();
    const klineBuffer = this.bot.exchange.getKlinesBuffer(
      this.bot.config.assetSymbol,
      this.bot.config.timeFrameToTrade
    );
    const currentKline = klineBuffer?.getLast() ?? null;
    const currentPrice = currentKline?.close ?? null;

    this.headerBox.setContent(
      [
        `${this.bot.config.assetSymbol} ${this.bot.config.timeFrameToTrade} | ${this.bot.getState()} | ind=${snapshots.length} | pos=${this.bot.positionManager.getNumOpenedPositions()}`,
        `px=${currentPrice === null ? '-' : formatNumber(currentPrice)} | kline=${formatTimestamp(currentKline?.timestamp ?? null)} | ${this.refreshMs}ms`,
      ].join('\n')
    );

    const screenWidth = this.screen.width as number;
    const columnCount = getColumnCount(screenWidth);
    const cardWidth = computeCardWidth(screenWidth, columnCount);
    const innerWidth = Math.max(24, cardWidth - 4);

    let currentTop = 0;
    let rowHeight = 0;

    for (const [index, snapshot] of snapshots.entries()) {
      let card = this.cardBoxes.get(snapshot.id);
      if (!card) {
        card = blessed.box({
          parent: this.bodyBox,
          tags: false,
          border: 'line',
          scrollable: true,
          alwaysScroll: true,
          style: {
            border: { fg: 'green' },
          },
        });
        this.cardBoxes.set(snapshot.id, card);
      }

      const lines = [
        ...formatIndicatorValueLines(snapshot.lastValue),
      ];
      const cardHeight = Math.max(4, Math.min(12, lines.length + 2));

      const columnIndex = index % columnCount;
      if (columnIndex === 0 && index > 0) {
        currentTop += rowHeight + CARD_GAP;
        rowHeight = 0;
      }

      const left = columnIndex * (cardWidth + CARD_GAP);
      rowHeight = Math.max(rowHeight, cardHeight);

      card.top = currentTop;
      card.left = left;
      card.width = cardWidth;
      card.height = cardHeight;
      card.setLabel(` ${compactIndicatorId(snapshot.id)} `);
      card.setContent(lines.join('\n'));
      card.show();
      card.setScroll(0);
      card.width = cardWidth;
      card.height = cardHeight;
      card.setContent(lines.map((line) => line.slice(0, innerWidth * 4)).join('\n'));
    }

    for (const [id, card] of this.cardBoxes.entries()) {
      if (!snapshots.some((snapshot) => snapshot.id === id)) {
        card.hide();
      }
    }

    const rowCount = snapshots.length === 0 ? 1 : Math.ceil(snapshots.length / columnCount);
    this.bodyBox.setScrollPerc(0);
    this.bodyBox.setContent(
      snapshots.length === 0
        ? 'No indicators are registered yet. Waiting for preload or strategy initialization...'
        : ''
    );
    this.bodyBox.setLabel(` Indicators (${snapshots.length}) `);

    const contentHeight = currentTop + rowHeight + (rowCount > 0 ? 1 : 0);
    this.bodyBox.setScroll(0);
    (this.bodyBox as Widgets.BoxElement & { childBase?: number }).childBase = Math.min(
      (this.bodyBox as Widgets.BoxElement & { childBase?: number }).childBase ?? 0,
      Math.max(0, contentHeight)
    );

    this.footerBox.setContent(`j/k scroll  PgUp/PgDn page  q exit  ${snapshots.length} ind`);

    this.screen.render();
  }
}

export { formatIndicatorValue, formatIndicatorValueLines };
