import ansis from 'ansis';
import os from 'os';

export class ConfigOptimizerReport {
  private fitnessValues: number[] = [];
  private winRateValues: number[] = [];

  public reset(): void {
    this.fitnessValues = [];
    this.winRateValues = [];
  }

  public addFitnessValue(fitness: number): void {
    this.fitnessValues.push(fitness);
  }

  public addWinRateValue(winRate: number): void {
    this.winRateValues.push(winRate);
  }

  public getTotalCount(): number {
    return this.fitnessValues.length;
  }

  private getStatistics(values: number[]): {
    n: number;
    mean: number;
    stdDev: number;
  } {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;

    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const mean = sum / n;
    const squaredDiffs = sorted.map((v) => Math.pow(v - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((acc, v) => acc + v, 0) / n;
    const stdDev = Math.sqrt(avgSquaredDiff);

    return {
      n,
      mean,
      stdDev,
    };
  }

  private buildHistogram(
    values: number[],
    bucketCount: number,
    rangeMin: number,
    rangeMax: number
  ): number[] {
    const buckets = new Array(bucketCount).fill(0);
    const range = rangeMax - rangeMin;
    for (const v of values) {
      const normalized = (v - rangeMin) / range;
      const bucketIdx = Math.min(
        bucketCount - 1,
        Math.max(0, Math.floor(normalized * bucketCount))
      );
      buckets[bucketIdx]++;
    }
    return buckets;
  }

  private formatDistributionSection(
    title: string,
    values: number[],
    bucketCount: number,
    rangeMin: number,
    rangeMax: number,
    decimals: number = 4,
    unit: string = ''
  ): string {
    if (values.length === 0) {
      return '';
    }

    const stats = this.getStatistics(values);
    const buckets = this.buildHistogram(values, bucketCount, rangeMin, rangeMax);
    const maxBucket = Math.max(...buckets);
    const barWidth = 40;
    const range = rangeMax - rangeMin;
    const step = range / bucketCount;

    let section = '';
    section += os.EOL;
    section += ansis.cyan(
      '════════════════════════════════════════════════════════════════════════════════════════════════════════════'
    );
    section += os.EOL;
    section += ansis.cyan.bold(`   📊 ${title}`);
    section += os.EOL;
    section += ansis.cyan(
      '════════════════════════════════════════════════════════════════════════════════════════════════════════════'
    );
    section += os.EOL;
    section += `  Total Evaluations: ${ansis.yellow(stats.n.toString())}`;
    section += os.EOL;
    section += os.EOL;
    section += ansis.bold('  Statistics:');
    section += os.EOL;
    section += `    Mean:     ${ansis.green(stats.mean.toFixed(decimals))}${unit}`;
    section += os.EOL;
    section += `    Std Dev:  ${ansis.green(stats.stdDev.toFixed(decimals))}${unit}`;
    section += os.EOL;
    section += os.EOL;
    section += os.EOL;
    section += ansis.bold(`  Distribution (${rangeMin}-${rangeMax}${unit}):`);
    section += os.EOL;

    for (let i = 0; i < bucketCount; i++) {
      const rangeStart = (rangeMin + i * step).toFixed(decimals > 2 ? 2 : decimals);
      const rangeEnd = (rangeMin + (i + 1) * step).toFixed(decimals > 2 ? 2 : decimals);
      const count = buckets[i] ?? 0;
      const pct = ((count / stats.n) * 100).toFixed(1);
      const barLength = maxBucket > 0 ? Math.round((count / maxBucket) * barWidth) : 0;
      const bar = '█'.repeat(barLength);
      const countStr = count.toString().padStart(5);
      const pctStr = pct.padStart(5);
      section += `    ${rangeStart.padStart(5)}-${rangeEnd.padStart(5)}${unit}: ${ansis.cyan(bar.padEnd(barWidth))} ${countStr} (${pctStr}%)`;
      section += os.EOL;
    }

    section += ansis.cyan(
      '════════════════════════════════════════════════════════════════════════════════════════════════════════════'
    );
    section += os.EOL;

    return section;
  }

  public getFitnessDistributionReport(): string {
    if (this.fitnessValues.length === 0) {
      return 'No fitness values collected.';
    }

    let report = '';

    // Fitness distribution (0-1)
    report += this.formatDistributionSection(
      'Global Fitness Distribution (Walk-Forward OOS)',
      this.fitnessValues,
      10,
      0,
      1,
      4
    );

    // WinRate distribution (0-100%)
    if (this.winRateValues.length > 0) {
      report += this.formatDistributionSection(
        'Global Win Rate Distribution (Walk-Forward OOS)',
        this.winRateValues,
        10,
        0,
        100,
        2,
        '%'
      );
    }

    return report;
  }
}
