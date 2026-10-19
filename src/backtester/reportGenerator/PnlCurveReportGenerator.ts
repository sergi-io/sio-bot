import type { ALXPosition } from '@/domain/ALXPosition';
import type { BackTestOutput } from '@/backtester/BackTester';
import fs from 'fs';
import path from 'path';
import { logger } from '@/utils/logger';
import process from 'process';
import { ensureFolderInPath } from '@/utils/folders';

type PnlCurvePoint = {
  timestamp: number;
  cumulativePnl: number;
  balance: number;
  positionPnl: number;
  symbol: string;
  side: string;
  status: 'start' | 'closed' | 'open';
};

type PnlCurveReportData = {
  initialBalance: number;
  finalBalance: number;
  pnl: number;
  points: PnlCurvePoint[];
};

export class PnlCurveReportGenerator {
  constructor(private backtestOutput: BackTestOutput) {}

  public generateCurvePoints(): PnlCurvePoint[] {
    const klines = this.backtestOutput.klines ?? [];
    const positions = this.backtestOutput.positions ?? [];
    const firstPositionTimestamp = positions.reduce<number | null>((oldestTimestamp, position) => {
      if (oldestTimestamp === null) {
        return position.openTimestamp;
      }
      return Math.min(oldestTimestamp, position.openTimestamp);
    }, null);
    const startTimestamp = klines[0]?.timestamp ?? firstPositionTimestamp ?? 0;
    const endTimestamp =
      klines[klines.length - 1]?.timestamp ??
      positions.reduce((latestTimestamp, position) => {
        return Math.max(latestTimestamp, position.closeTimestamp ?? position.openTimestamp);
      }, startTimestamp);
    const closedPositions = positions.filter(
      (position): position is ALXPosition & { closeTimestamp: number } =>
        position.closeTimestamp !== undefined
    );
    const openPositions = positions.filter((position) => position.closeTimestamp === undefined);
    const sortedEvents = [
      ...closedPositions.map((position) => ({
        position,
        timestamp: position.closeTimestamp,
        status: 'closed' as const,
      })),
      ...openPositions.map((position) => ({
        position,
        timestamp: endTimestamp,
        status: 'open' as const,
      })),
    ].sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp;
      }
      return left.position.openTimestamp - right.position.openTimestamp;
    });

    let cumulativePnl = 0;
    const points: PnlCurvePoint[] = [
      {
        timestamp: startTimestamp,
        cumulativePnl,
        balance: this.backtestOutput.initialBalance,
        positionPnl: 0,
        symbol: 'Start',
        side: '',
        status: 'start',
      },
    ];

    for (const event of sortedEvents) {
      cumulativePnl += event.position.realizedPnl;
      points.push({
        timestamp: event.timestamp,
        cumulativePnl,
        balance: this.backtestOutput.initialBalance + cumulativePnl,
        positionPnl: event.position.realizedPnl,
        symbol: event.position.symbol,
        side: event.position.side,
        status: event.status,
      });
    }

    return points;
  }

  public generate(): void {
    logger.info('PnlCurveReportGenerator: Generating PnL curve report...');

    const reportData: PnlCurveReportData = {
      initialBalance: this.backtestOutput.initialBalance,
      finalBalance: this.backtestOutput.finalBalance,
      pnl: this.backtestOutput.pnl,
      points: this.generateCurvePoints(),
    };
    const outputPath = path.resolve(process.cwd(), 'outputs/backtest/pnl-curve.html');
    ensureFolderInPath(outputPath);
    fs.writeFileSync(outputPath, this.renderHtml(reportData), 'utf8');
    logger.info(`PnlCurveReportGenerator: PnL curve report generated at file://${outputPath}`);
  }

  private renderHtml(reportData: PnlCurveReportData): string {
    const serializedReportData = JSON.stringify(reportData).replace(/</g, '\\u003c');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Backtest PnL Curve</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f8fa;
      --panel: #ffffff;
      --text: #111827;
      --muted: #6b7280;
      --border: #d1d5db;
      --grid: #e5e7eb;
      --positive: #059669;
      --negative: #dc2626;
      --accent: #2563eb;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --panel: #111827;
        --text: #f9fafb;
        --muted: #9ca3af;
        --border: #374151;
        --grid: #253044;
        --positive: #34d399;
        --negative: #f87171;
        --accent: #60a5fa;
      }
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      width: min(1280px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 24px 0 32px;
    }

    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: 0;
    }

    .subtitle {
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }

    .metric {
      min-width: 0;
      padding: 10px 12px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .metric-label {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
    }

    .metric-value {
      margin-top: 4px;
      font-size: 18px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .chart-panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }

    .chart-wrap {
      position: relative;
      width: 100%;
      height: min(68vh, 720px);
      min-height: 420px;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
    }

    .axis,
    .grid {
      stroke: var(--grid);
      stroke-width: 1;
      shape-rendering: crispEdges;
    }

    .axis-label,
    .tick {
      fill: var(--muted);
      font-size: 12px;
    }

    .curve {
      fill: none;
      stroke: var(--accent);
      stroke-width: 2.5;
    }

    .zero-line {
      stroke: var(--muted);
      stroke-dasharray: 4 4;
    }

    .point {
      cursor: pointer;
      stroke: var(--panel);
      stroke-width: 2;
    }

    .tooltip {
      position: absolute;
      z-index: 2;
      max-width: min(320px, calc(100vw - 48px));
      padding: 9px 10px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 8px 28px rgba(15, 23, 42, 0.18);
      color: var(--text);
      font-size: 12px;
      pointer-events: none;
      opacity: 0;
      transform: translate(8px, -50%);
      transition: opacity 120ms ease;
    }

    .tooltip.visible {
      opacity: 1;
    }

    .tooltip-title {
      font-weight: 700;
      margin-bottom: 4px;
    }

    .tooltip-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      line-height: 1.45;
    }

    .positive {
      color: var(--positive);
    }

    .negative {
      color: var(--negative);
    }

    @media (max-width: 760px) {
      main {
        width: min(100vw - 20px, 1280px);
        padding-top: 14px;
      }

      header {
        display: block;
      }

      .summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .chart-wrap {
        min-height: 360px;
        height: 62vh;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Backtest PnL Curve</h1>
        <div class="subtitle" id="date-range"></div>
      </div>
    </header>

    <section class="summary" aria-label="Backtest summary">
      <div class="metric">
        <div class="metric-label">Initial balance</div>
        <div class="metric-value" id="initial-balance"></div>
      </div>
      <div class="metric">
        <div class="metric-label">Final balance</div>
        <div class="metric-value" id="final-balance"></div>
      </div>
      <div class="metric">
        <div class="metric-label">Total PnL</div>
        <div class="metric-value" id="total-pnl"></div>
      </div>
      <div class="metric">
        <div class="metric-label">PnL events</div>
        <div class="metric-value" id="event-count"></div>
      </div>
    </section>

    <section class="chart-panel">
      <div class="chart-wrap">
        <svg id="chart" role="img" aria-label="Cumulative PnL curve"></svg>
        <div class="tooltip" id="tooltip"></div>
      </div>
    </section>
  </main>

  <script>
    const reportData = ${serializedReportData};
    const chart = document.getElementById('chart');
    const tooltip = document.getElementById('tooltip');
    const chartWrap = chart.parentElement;
    const money = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const dateTime = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    function setText(id, value, signedValue) {
      const el = document.getElementById(id);
      el.textContent = value;
      if (signedValue > 0) el.classList.add('positive');
      if (signedValue < 0) el.classList.add('negative');
    }

    function formatSignedMoney(value) {
      const formatted = money.format(value);
      return value > 0 ? '+' + formatted : formatted;
    }

    function renderSummary() {
      const points = reportData.points;
      const first = points[0];
      const last = points[points.length - 1];
      document.getElementById('date-range').textContent =
        first && last
          ? dateTime.format(new Date(first.timestamp)) + ' - ' + dateTime.format(new Date(last.timestamp))
          : 'No PnL events found';
      setText('initial-balance', money.format(reportData.initialBalance), 0);
      setText('final-balance', money.format(reportData.finalBalance), reportData.pnl);
      setText('total-pnl', formatSignedMoney(reportData.pnl), reportData.pnl);
      setText('event-count', Math.max(0, points.length - 1).toString(), 0);
    }

    function clearChart() {
      while (chart.firstChild) {
        chart.removeChild(chart.firstChild);
      }
    }

    function createSvgElement(tag, attrs) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, String(value));
      }
      return el;
    }

    function extent(values) {
      return values.reduce(
        (range, value) => [Math.min(range[0], value), Math.max(range[1], value)],
        [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
      );
    }

    function buildTicks(min, max, count) {
      if (min === max) {
        return [min];
      }
      const ticks = [];
      for (let i = 0; i < count; i += 1) {
        ticks.push(min + ((max - min) * i) / (count - 1));
      }
      return ticks;
    }

    function showTooltip(point, x, y) {
      const statusLabel =
        point.status === 'start' ? 'Start' : point.status === 'open' ? 'Open at end' : 'Closed';
      tooltip.innerHTML = [
        '<div class="tooltip-title">' + statusLabel + '</div>',
        '<div class="tooltip-row"><span>Date</span><strong>' +
          dateTime.format(new Date(point.timestamp)) +
          '</strong></div>',
        '<div class="tooltip-row"><span>Symbol</span><strong>' + point.symbol + '</strong></div>',
        '<div class="tooltip-row"><span>Side</span><strong>' + point.side + '</strong></div>',
        '<div class="tooltip-row"><span>Event PnL</span><strong>' +
          formatSignedMoney(point.positionPnl) +
          '</strong></div>',
        '<div class="tooltip-row"><span>Cumulative PnL</span><strong>' +
          formatSignedMoney(point.cumulativePnl) +
          '</strong></div>',
        '<div class="tooltip-row"><span>Balance</span><strong>' +
          money.format(point.balance) +
          '</strong></div>',
      ].join('');
      const tooltipRect = tooltip.getBoundingClientRect();
      const wrapRect = chartWrap.getBoundingClientRect();
      const left = Math.min(Math.max(8, x + 10), wrapRect.width - tooltipRect.width - 8);
      const top = Math.min(Math.max(tooltipRect.height / 2 + 8, y), wrapRect.height - 8);
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
      tooltip.classList.add('visible');
    }

    function hideTooltip() {
      tooltip.classList.remove('visible');
    }

    function renderChart() {
      clearChart();
      const points = reportData.points;
      const rect = chart.getBoundingClientRect();
      const width = Math.max(320, rect.width);
      const height = Math.max(320, rect.height);
      const margin = { top: 24, right: 30, bottom: 44, left: 74 };
      const innerWidth = width - margin.left - margin.right;
      const innerHeight = height - margin.top - margin.bottom;

      chart.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

      if (points.length === 0) {
        const empty = createSvgElement('text', {
          x: width / 2,
          y: height / 2,
          'text-anchor': 'middle',
          class: 'axis-label',
        });
        empty.textContent = 'No PnL events found';
        chart.appendChild(empty);
        return;
      }

      const [minTimestamp, maxTimestamp] = extent(points.map((point) => point.timestamp));
      let [minPnl, maxPnl] = extent(points.map((point) => point.cumulativePnl));
      minPnl = Math.min(minPnl, 0);
      maxPnl = Math.max(maxPnl, 0);
      const pnlPadding = Math.max(1, (maxPnl - minPnl) * 0.12);
      minPnl -= pnlPadding;
      maxPnl += pnlPadding;
      const timestampSpan = Math.max(1, maxTimestamp - minTimestamp);
      const pnlSpan = Math.max(1, maxPnl - minPnl);
      const xScale = (timestamp) =>
        margin.left + ((timestamp - minTimestamp) / timestampSpan) * innerWidth;
      const yScale = (pnl) => margin.top + (1 - (pnl - minPnl) / pnlSpan) * innerHeight;

      for (const tick of buildTicks(minPnl, maxPnl, 6)) {
        const y = yScale(tick);
        chart.appendChild(
          createSvgElement('line', {
            x1: margin.left,
            y1: y,
            x2: width - margin.right,
            y2: y,
            class: tick === 0 ? 'zero-line' : 'grid',
          })
        );
        const label = createSvgElement('text', {
          x: margin.left - 10,
          y: y + 4,
          'text-anchor': 'end',
          class: 'tick',
        });
        label.textContent = money.format(tick);
        chart.appendChild(label);
      }

      for (const tick of buildTicks(minTimestamp, maxTimestamp, 5)) {
        const x = xScale(tick);
        chart.appendChild(
          createSvgElement('line', {
            x1: x,
            y1: margin.top,
            x2: x,
            y2: height - margin.bottom,
            class: 'grid',
          })
        );
        const label = createSvgElement('text', {
          x,
          y: height - margin.bottom + 24,
          'text-anchor': 'middle',
          class: 'tick',
        });
        label.textContent = new Date(tick).toISOString().slice(0, 10);
        chart.appendChild(label);
      }

      chart.appendChild(
        createSvgElement('line', {
          x1: margin.left,
          y1: height - margin.bottom,
          x2: width - margin.right,
          y2: height - margin.bottom,
          class: 'axis',
        })
      );
      chart.appendChild(
        createSvgElement('line', {
          x1: margin.left,
          y1: margin.top,
          x2: margin.left,
          y2: height - margin.bottom,
          class: 'axis',
        })
      );

      const pathData = points
        .map((point, index) => {
          const command = index === 0 ? 'M' : 'L';
          return command + xScale(point.timestamp) + ' ' + yScale(point.cumulativePnl);
        })
        .join(' ');
      chart.appendChild(createSvgElement('path', { d: pathData, class: 'curve' }));

      for (const point of points) {
        const x = xScale(point.timestamp);
        const y = yScale(point.cumulativePnl);
        const circle = createSvgElement('circle', {
          cx: x,
          cy: y,
          r: point.status === 'start' ? 4 : 5,
          class: 'point',
          fill: point.positionPnl >= 0 ? 'var(--positive)' : 'var(--negative)',
        });
        circle.addEventListener('mousemove', () => showTooltip(point, x, y));
        circle.addEventListener('mouseleave', hideTooltip);
        chart.appendChild(circle);
      }
    }

    renderSummary();
    renderChart();
    window.addEventListener('resize', renderChart);
  </script>
</body>
</html>`;
  }
}
