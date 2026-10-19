import fs from 'fs';
import path from 'path';
import {
  BotConfig,
  ConfigValueType,
  type ConfigBinaryValue,
  type ConfigBooleanValue,
  type ConfigNumberValue,
  type ConfigStringValue,
} from '@/siobot/BotConfig';
import { ensureFolderInPath } from '@/utils/folders';
import type { EvaluationResult, OptimizerMode } from './types';

const MAX_EXACT_BUCKETS = 36;
const MAX_BUCKETS = 24;
const TOP_DECILE_RATIO = 0.1;

type ParameterKind = 'number' | 'string' | 'boolean' | 'binary';

type RankedEvaluation = {
  evaluation: EvaluationResult;
  fitness: number;
  fitnessPercentile: number;
  isTopDecile: boolean;
};

type ParameterDefinition = {
  key: keyof BotConfig;
  label: string;
  kind: ParameterKind;
  values: Array<number | string | boolean>;
  bits?: number;
};

type Bucket = {
  label: string;
  values: Array<number | string | boolean>;
  members: Set<number | string | boolean>;
};

type HeatmapCell = {
  label: string;
  count: number;
  meanFitnessPercentile: number | null;
  meanFitness: number | null;
  meanPnl: number | null;
  medianPnl: number | null;
  topDecileCount: number;
  topDecileRate: number | null;
};

type HeatmapParameter = {
  key: string;
  label: string;
  kind: ParameterKind;
  bestZone: string;
  plateauBins: number;
  sampledBins: number;
  totalBins: number;
  topDecileConcentration: number;
  cells: HeatmapCell[];
};

type StabilityHeatmapData = {
  generatedAt: string;
  mode: OptimizerMode;
  totalEvaluations: number;
  walkForwardFolds: number;
  startTimestampMs: number;
  endTimestampMs: number;
  topDecileCount: number;
  parameters: HeatmapParameter[];
};

type SaveParams = {
  evaluations: EvaluationResult[];
  mode: OptimizerMode;
  walkForwardFolds: number;
  startTimestampMs: number;
  endTimestampMs: number;
};

export class ConfigOptimizerStabilityHeatmap {
  constructor(private readonly botConfig: BotConfig) {}

  public save(params: SaveParams): { htmlPath: string; jsonPath: string } | null {
    const rankedEvaluations = this.rankEvaluations(params.evaluations);
    if (rankedEvaluations.length === 0) {
      return null;
    }

    const parameterDefinitions = this.getOptimizedParameters();
    if (parameterDefinitions.length === 0) {
      return null;
    }

    const topDecileCount = Math.max(1, Math.ceil(rankedEvaluations.length * TOP_DECILE_RATIO));
    const parameters = parameterDefinitions
      .map((definition) => this.buildParameterHeatmap(definition, rankedEvaluations))
      .filter((parameter): parameter is HeatmapParameter => parameter !== null);

    if (parameters.length === 0) {
      return null;
    }

    const data: StabilityHeatmapData = {
      generatedAt: new Date().toISOString(),
      mode: params.mode,
      totalEvaluations: rankedEvaluations.length,
      walkForwardFolds: params.walkForwardFolds,
      startTimestampMs: params.startTimestampMs,
      endTimestampMs: params.endTimestampMs,
      topDecileCount,
      parameters,
    };

    const basePath = path.resolve(
      process.cwd(),
      `outputs/configs/${params.mode}_parameter_stability_heatmap`
    );
    const htmlPath = `${basePath}.html`;
    const jsonPath = `${basePath}.json`;

    ensureFolderInPath(htmlPath);
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
    fs.writeFileSync(htmlPath, this.renderHtml(data), 'utf8');

    return { htmlPath, jsonPath };
  }

  private rankEvaluations(evaluations: EvaluationResult[]): RankedEvaluation[] {
    const valid = evaluations
      .map((evaluation) => {
        const fitness = evaluation.fitness;
        if (!Number.isFinite(fitness)) {
          return null;
        }
        return {
          evaluation,
          fitness,
        };
      })
      .filter((entry): entry is { evaluation: EvaluationResult; fitness: number } => entry !== null)
      .sort((a, b) => b.fitness - a.fitness);

    if (valid.length === 0) {
      return [];
    }

    const topDecileCount = Math.max(1, Math.ceil(valid.length * TOP_DECILE_RATIO));

    return valid.map((entry, index) => ({
      ...entry,
      fitnessPercentile: valid.length === 1 ? 1 : 1 - index / (valid.length - 1),
      isTopDecile: index < topDecileCount,
    }));
  }

  private buildParameterHeatmap(
    definition: ParameterDefinition,
    rankedEvaluations: RankedEvaluation[]
  ): HeatmapParameter | null {
    const buckets = this.buildBuckets(definition);
    if (buckets.length === 0) {
      return null;
    }

    const groupedSamples = buckets.map((bucket) => ({
      bucket,
      samples: rankedEvaluations.filter((ranked) => {
        const value = this.getConfigValue(ranked.evaluation.config, definition.key);
        if (value === undefined) {
          return false;
        }
        return bucket.members.has(value);
      }),
    }));

    const cells = groupedSamples.map<HeatmapCell>(({ bucket, samples }) => {
      if (samples.length === 0) {
        return {
          label: bucket.label,
          count: 0,
          meanFitnessPercentile: null,
          meanFitness: null,
          meanPnl: null,
          medianPnl: null,
          topDecileCount: 0,
          topDecileRate: null,
        };
      }

      const pnlValues = samples.map((sample) => sample.evaluation.pnl).sort((a, b) => a - b);
      const topDecileCount = samples.filter((sample) => sample.isTopDecile).length;

      return {
        label: bucket.label,
        count: samples.length,
        meanFitnessPercentile: this.average(samples.map((sample) => sample.fitnessPercentile)),
        meanFitness: this.average(samples.map((sample) => sample.fitness)),
        meanPnl: this.average(samples.map((sample) => sample.evaluation.pnl)),
        medianPnl: this.median(pnlValues),
        topDecileCount,
        topDecileRate: topDecileCount / samples.length,
      };
    });

    const sampledCells = cells.filter((cell) => cell.count > 0);
    if (sampledCells.length === 0) {
      return null;
    }

    const bestCell = sampledCells.reduce((best, cell) => {
      if ((cell.meanFitnessPercentile ?? Number.NEGATIVE_INFINITY) >
        (best.meanFitnessPercentile ?? Number.NEGATIVE_INFINITY)) {
        return cell;
      }
      return best;
    }, sampledCells[0]!);
    const bestMeanFitnessPercentile = bestCell.meanFitnessPercentile ?? 0;
    const plateauThreshold = bestMeanFitnessPercentile * 0.9;
    const plateauBins = sampledCells.filter(
      (cell) => (cell.meanFitnessPercentile ?? 0) >= plateauThreshold
    ).length;
    const topDecileHits = sampledCells.reduce((sum, cell) => sum + cell.topDecileCount, 0);
    const topDecileConcentration =
      topDecileHits === 0
        ? 0
        : Math.max(...sampledCells.map((cell) => cell.topDecileCount)) / topDecileHits;

    return {
      key: String(definition.key),
      label: definition.label,
      kind: definition.kind,
      bestZone: bestCell.label,
      plateauBins,
      sampledBins: sampledCells.length,
      totalBins: cells.length,
      topDecileConcentration,
      cells,
    };
  }

  private getOptimizedParameters(): ParameterDefinition[] {
    const parameters: ParameterDefinition[] = [];

    for (const key of Object.keys(this.botConfig) as Array<keyof BotConfig>) {
      const configValue = this.botConfig[key];

      if (this.isNumberConfig(configValue) && configValue.optimize) {
        parameters.push({
          key,
          label: this.formatParameterLabel(String(key)),
          kind: 'number',
          values: this.buildNumericRange(configValue),
        });
        continue;
      }

      if (this.isStringConfig(configValue) && configValue.optimize) {
        parameters.push({
          key,
          label: this.formatParameterLabel(String(key)),
          kind: 'string',
          values: [...new Set(configValue.values)],
        });
        continue;
      }

      if (this.isBooleanConfig(configValue) && configValue.optimize) {
        parameters.push({
          key,
          label: this.formatParameterLabel(String(key)),
          kind: 'boolean',
          values: [true, false],
        });
        continue;
      }

      if (this.isBinaryConfig(configValue) && configValue.optimize) {
        parameters.push({
          key,
          label: this.formatParameterLabel(String(key)),
          kind: 'binary',
          values: this.buildBinaryRange(configValue),
          bits: configValue.bits,
        });
      }
    }

    return parameters;
  }

  private buildBuckets(definition: ParameterDefinition): Bucket[] {
    const values = definition.values;
    if (
      definition.kind === 'string' ||
      definition.kind === 'boolean' ||
      values.length <= MAX_EXACT_BUCKETS
    ) {
      return values.map((value) => ({
        label: this.formatValue(value, definition),
        values: [value],
        members: new Set([value]),
      }));
    }

    const bucketCount = Math.min(MAX_BUCKETS, values.length);
    const bucketSize = Math.ceil(values.length / bucketCount);
    const buckets: Bucket[] = [];

    for (let index = 0; index < values.length; index += bucketSize) {
      const bucketValues = values.slice(index, index + bucketSize);
      if (bucketValues.length === 0) {
        continue;
      }

      const first = bucketValues[0]!;
      const last = bucketValues[bucketValues.length - 1]!;
      const label =
        bucketValues.length === 1
          ? this.formatValue(first, definition)
          : `${this.formatValue(first, definition)} - ${this.formatValue(last, definition)}`;

      buckets.push({
        label,
        values: bucketValues,
        members: new Set(bucketValues),
      });
    }

    return buckets;
  }

  private buildNumericRange(configValue: ConfigNumberValue): number[] {
    if (configValue.step === 0) {
      return [configValue.value];
    }

    const values: number[] = [];
    const ascending = configValue.to >= configValue.from;
    const step = Math.abs(configValue.step);

    if (ascending) {
      for (let current = configValue.from; current <= configValue.to + 1e-12; current += step) {
        values.push(Number(current.toFixed(12)));
      }
      return values;
    }

    for (let current = configValue.from; current >= configValue.to - 1e-12; current -= step) {
      values.push(Number(current.toFixed(12)));
    }

    return values;
  }

  private buildBinaryRange(configValue: ConfigBinaryValue): number[] {
    const values: number[] = [];
    const totalCombinations = 1 << configValue.bits;

    for (let current = 0; current < totalCombinations; current++) {
      values.push(current);
    }

    return values;
  }

  private getConfigValue(
    config: EvaluationResult['config'],
    key: keyof BotConfig
  ): number | string | boolean | undefined {
    const rawValue = (config as Record<string, unknown>)[key as string];
    if (
      rawValue &&
      typeof rawValue === 'object' &&
      'value' in rawValue &&
      typeof (rawValue as { value?: unknown }).value !== 'object'
    ) {
      const primitiveValue = (rawValue as { value?: unknown }).value;
      if (
        typeof primitiveValue === 'number' ||
        typeof primitiveValue === 'string' ||
        typeof primitiveValue === 'boolean'
      ) {
        return primitiveValue;
      }
      return undefined;
    }

    if (
      typeof rawValue === 'number' ||
      typeof rawValue === 'string' ||
      typeof rawValue === 'boolean'
    ) {
      return rawValue;
    }

    return undefined;
  }

  private average(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private median(sortedValues: number[]): number {
    if (sortedValues.length === 0) {
      return 0;
    }
    const middle = Math.floor(sortedValues.length / 2);
    if (sortedValues.length % 2 === 0) {
      return (sortedValues[middle - 1]! + sortedValues[middle]!) / 2;
    }
    return sortedValues[middle]!;
  }

  private renderHtml(data: StabilityHeatmapData): string {
    const maxCellCount = Math.max(
      1,
      ...data.parameters.flatMap((parameter) => parameter.cells.map((cell) => cell.count))
    );

    const summaryRows = data.parameters
      .map(
        (parameter) => `
          <tr>
            <td>${this.escapeHtml(parameter.label)}</td>
            <td>${this.escapeHtml(parameter.bestZone)}</td>
            <td>${parameter.plateauBins}</td>
            <td>${parameter.sampledBins}/${parameter.totalBins}</td>
            <td>${this.formatPercent(parameter.topDecileConcentration)}</td>
          </tr>
        `
      )
      .join('');

    const parameterSections = data.parameters
      .map((parameter) => {
        const cells = parameter.cells
          .map((cell) => {
            const tooltip = this.buildCellTooltip(parameter, cell);
            const countRatio = cell.count === 0 ? 0 : cell.count / maxCellCount;
            const backgroundColor = this.getCellBackgroundColor(
              cell.meanFitnessPercentile,
              countRatio
            );

            return `
              <div
                class="cell ${cell.count === 0 ? 'empty' : ''}"
                style="background:${backgroundColor};"
                title="${this.escapeHtml(tooltip)}"
              >
                <span class="cell-label">${this.escapeHtml(cell.label)}</span>
                <span class="cell-score">${
                  cell.meanFitnessPercentile === null
                    ? 'No data'
                    : `Q${Math.round(cell.meanFitnessPercentile * 100)}`
                }</span>
                <span class="cell-meta">${
                  cell.count === 0
                    ? 'n=0'
                    : `n=${cell.count} • top=${Math.round((cell.topDecileRate ?? 0) * 100)}%`
                }</span>
              </div>
            `;
          })
          .join('');

        return `
          <section class="parameter-card">
            <div class="parameter-header">
              <div>
                <h2>${this.escapeHtml(parameter.label)}</h2>
                <p class="parameter-key">${this.escapeHtml(parameter.key)} · ${parameter.kind}</p>
              </div>
              <div class="parameter-badges">
                <span>Best zone: ${this.escapeHtml(parameter.bestZone)}</span>
                <span>Plateau bins: ${parameter.plateauBins}</span>
                <span>Top-decile concentration: ${this.formatPercent(
                  parameter.topDecileConcentration
                )}</span>
              </div>
            </div>
            <div class="heatmap-grid">${cells}</div>
          </section>
        `;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Parameter Stability Heatmap</title>
    <style>
      :root {
        --bg: #0b1114;
        --panel: rgba(14, 27, 31, 0.92);
        --panel-border: rgba(138, 184, 165, 0.18);
        --text: #ebf3ef;
        --muted: #9eb0ab;
        --accent: #c6f26d;
        --danger: #ff8b61;
        --table-row: rgba(255, 255, 255, 0.03);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif;
        background:
          radial-gradient(circle at top, rgba(198, 242, 109, 0.12), transparent 28%),
          linear-gradient(180deg, #071014 0%, #0d171c 52%, #111718 100%);
        color: var(--text);
      }

      main {
        width: min(1500px, calc(100% - 32px));
        margin: 32px auto 48px;
      }

      .hero,
      .summary,
      .parameter-card {
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 22px;
        box-shadow: 0 20px 70px rgba(0, 0, 0, 0.28);
      }

      .hero {
        padding: 28px;
        margin-bottom: 20px;
      }

      h1,
      h2,
      p {
        margin: 0;
      }

      h1 {
        font-size: clamp(1.8rem, 4vw, 3.2rem);
        letter-spacing: -0.03em;
      }

      .hero-copy {
        color: var(--muted);
        margin-top: 10px;
        max-width: 900px;
        line-height: 1.6;
      }

      .meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-top: 22px;
      }

      .meta-card {
        padding: 14px 16px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.05);
      }

      .meta-label {
        display: block;
        color: var(--muted);
        font-size: 0.78rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 6px;
      }

      .meta-value {
        font-size: 1.05rem;
        font-weight: 600;
      }

      .summary {
        padding: 24px 28px;
        margin-bottom: 20px;
      }

      .summary h2 {
        margin-bottom: 6px;
      }

      .summary-copy {
        color: var(--muted);
        margin-bottom: 18px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        padding: 12px 10px;
        text-align: left;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }

      th {
        color: var(--muted);
        font-size: 0.82rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      tbody tr:nth-child(odd) {
        background: var(--table-row);
      }

      .parameter-card {
        padding: 22px;
        margin-bottom: 16px;
      }

      .parameter-header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
        margin-bottom: 16px;
      }

      .parameter-key {
        color: var(--muted);
        margin-top: 6px;
      }

      .parameter-badges {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }

      .parameter-badges span {
        display: inline-flex;
        align-items: center;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.05);
        color: var(--muted);
        font-size: 0.9rem;
      }

      .heatmap-grid {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(88px, 1fr);
        gap: 10px;
        overflow-x: auto;
        padding-bottom: 8px;
      }

      .cell {
        min-height: 112px;
        padding: 10px;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 10px;
      }

      .cell.empty {
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02));
        color: var(--muted);
      }

      .cell-label {
        font-size: 0.8rem;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.92);
      }

      .cell-score {
        font-size: 1.2rem;
        font-weight: 700;
        letter-spacing: -0.03em;
      }

      .cell-meta {
        font-size: 0.78rem;
        color: rgba(255, 255, 255, 0.78);
      }

      @media (max-width: 900px) {
        main {
          width: min(100% - 16px, 100%);
          margin: 16px auto 28px;
        }

        .hero,
        .summary,
        .parameter-card {
          border-radius: 18px;
          padding: 18px;
        }

        .parameter-header {
          flex-direction: column;
        }

        .parameter-badges {
          justify-content: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>Parameter Stability Heatmap</h1>
        <p class="hero-copy">
          Color shows the average fitness percentile reached when a parameter landed on that
          value or value bucket across the full genetic search. Broad warm plateaus suggest
          robustness. Isolated hot cells with high top-decile concentration suggest a sharper,
          more overfit optimum.
        </p>
        <div class="meta-grid">
          <div class="meta-card">
            <span class="meta-label">Generated</span>
            <span class="meta-value">${this.escapeHtml(this.formatDate(data.generatedAt))}</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Evaluations</span>
            <span class="meta-value">${data.totalEvaluations}</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Top Bucket</span>
            <span class="meta-value">Top ${data.topDecileCount} runs</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Walk-Forward Folds</span>
            <span class="meta-value">${data.walkForwardFolds}</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Start</span>
            <span class="meta-value">${this.escapeHtml(
              this.formatDate(data.startTimestampMs)
            )}</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">End</span>
            <span class="meta-value">${this.escapeHtml(this.formatDate(data.endTimestampMs))}</span>
          </div>
        </div>
      </section>

      <section class="summary">
        <h2>Sharpness Summary</h2>
        <p class="summary-copy">
          Higher plateau counts are usually better. Lower top-decile concentration means the best
          runs were spread across more of the parameter range instead of collapsing into a single
          narrow zone.
        </p>
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Best Zone</th>
              <th>Plateau Bins</th>
              <th>Sampled Bins</th>
              <th>Top-Decile Concentration</th>
            </tr>
          </thead>
          <tbody>${summaryRows}</tbody>
        </table>
      </section>

      ${parameterSections}
    </main>
  </body>
</html>`;
  }

  private buildCellTooltip(parameter: HeatmapParameter, cell: HeatmapCell): string {
    if (cell.count === 0) {
      return `${parameter.label} · ${cell.label}\nNo samples collected`;
    }

    return [
      `${parameter.label} · ${cell.label}`,
      `Samples: ${cell.count}`,
      `Mean fitness percentile: ${this.formatPercent(cell.meanFitnessPercentile)}`,
      `Mean fitness: ${this.formatNumber(cell.meanFitness)}`,
      `Mean PnL: ${this.formatSignedNumber(cell.meanPnl)}`,
      `Median PnL: ${this.formatSignedNumber(cell.medianPnl)}`,
      `Top-decile hit rate: ${this.formatPercent(cell.topDecileRate)}`,
    ].join('\n');
  }

  private getCellBackgroundColor(
    meanFitnessPercentile: number | null,
    countRatio: number
  ): string {
    if (meanFitnessPercentile === null) {
      return 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))';
    }

    const hue = 12 + meanFitnessPercentile * 128;
    const saturation = 78;
    const lightness = 45 + meanFitnessPercentile * 10;
    const alpha = 0.28 + countRatio * 0.58;

    return `linear-gradient(180deg, hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha}), rgba(5, 14, 18, 0.92))`;
  }

  private formatParameterLabel(key: string): string {
    return key
      .replace(/_/g, ' / ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  private formatValue(
    value: number | string | boolean,
    definition: Pick<ParameterDefinition, 'kind' | 'bits'>
  ): string {
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (definition.kind === 'binary' && definition.bits) {
      return `0b${value.toString(2).padStart(definition.bits, '0')}`;
    }

    if (Number.isInteger(value)) {
      return value.toString();
    }

    return Number(value.toFixed(6)).toString();
  }

  private formatDate(value: number | string): string {
    return new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
  }

  private formatPercent(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return 'n/a';
    }
    return `${(value * 100).toFixed(1)}%`;
  }

  private formatNumber(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return 'n/a';
    }
    return value.toFixed(4);
  }

  private formatSignedNumber(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return 'n/a';
    }
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private isNumberConfig(value: unknown): value is ConfigNumberValue {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      value.type === ConfigValueType.NUMBER
    );
  }

  private isStringConfig(value: unknown): value is ConfigStringValue {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      value.type === ConfigValueType.STRING
    );
  }

  private isBooleanConfig(value: unknown): value is ConfigBooleanValue {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      value.type === ConfigValueType.BOOLEAN
    );
  }

  private isBinaryConfig(value: unknown): value is ConfigBinaryValue {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      value.type === ConfigValueType.BINARY
    );
  }
}
