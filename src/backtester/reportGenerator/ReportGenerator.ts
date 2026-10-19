import type { ALXKline } from '@/domain/ALXKline';
import type { ALXPosition } from '@/domain/ALXPosition';
import type { BackTestOutput } from '../BackTester';
import fs from 'fs';
import path from 'path';
import { logger } from '@/utils/logger';
import process from 'process';
import { ensureFolderInPath } from '@/utils/folders';

interface CandleAnnotation {
  openOrClose: 'O' | 'C';
  position: ALXPosition;
}

interface ReportCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  buyVolume: number;
  sellVolume: number;
  annotations: CandleAnnotation[];
}

interface ReportConfig {
  intervalMs: number;
}

export class ReportGenerator {
  constructor(private backtestOutput: BackTestOutput) {}

  public generateCandles(): ReportCandle[] {
    const annotationsByTimestamp = new Map<number, CandleAnnotation[]>();

    const positions = this.backtestOutput.positions ?? [];

    for (const position of positions) {
      const openAnnotations = annotationsByTimestamp.get(position.openTimestamp) ?? [];
      openAnnotations.push({ openOrClose: 'O', position });
      annotationsByTimestamp.set(position.openTimestamp, openAnnotations);

      if (position.closeTimestamp) {
        const closeAnnotations = annotationsByTimestamp.get(position.closeTimestamp) ?? [];
        closeAnnotations.push({ openOrClose: 'C', position });
        annotationsByTimestamp.set(position.closeTimestamp, closeAnnotations);
      }
    }

    const klines: ALXKline[] = this.backtestOutput.klines ?? [];
    if (klines.length === 0) {
      return [];
    }

    const groupedKlines: ALXKline[] = [];
    let lastKline: ALXKline | null = null;

    for (const kline of klines) {
      if (lastKline && kline.timestamp !== lastKline.timestamp) {
        groupedKlines.push(lastKline);
      }
      lastKline = kline;
    }

    if (lastKline) {
      const lastGrouped = groupedKlines[groupedKlines.length - 1];
      if (!lastGrouped || lastGrouped.timestamp !== lastKline.timestamp) {
        groupedKlines.push(lastKline);
      } else {
        groupedKlines[groupedKlines.length - 1] = lastKline;
      }
    }

    return groupedKlines.map((kline) => ({
      timestamp: kline.timestamp,
      open: kline.open,
      high: kline.high,
      low: kline.low,
      close: kline.close,
      buyVolume: kline.buyVolume,
      sellVolume: kline.sellVolume,
      annotations: annotationsByTimestamp.get(kline.timestamp) ?? [],
    }));
  }

  public generate(): void {
    logger.info('ReportGenerator: Generating report...');

    const candles = this.generateCandles();
    const templatePath = path.resolve(__dirname, 'report_template.html');
    const outputPath = path.resolve(process.cwd(), 'outputs/backtest/report.html');
    ensureFolderInPath(outputPath);
    const template = fs.readFileSync(templatePath, 'utf8');
    const reportConfig: ReportConfig = {
      intervalMs: candles.length > 1 ? candles[1]!.timestamp - candles[0]!.timestamp : 0,
    };
    let filled = template.replace('```{{candlesJSON}}```', JSON.stringify(candles));
    filled = filled.replace('```{{reportConfigJSON}}```', JSON.stringify(reportConfig));
    fs.writeFileSync(outputPath, filled, 'utf8');
    logger.info(`ReportGenerator: Report generated at file://${outputPath}`);
  }
}
