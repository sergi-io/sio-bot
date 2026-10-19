import { BotConfig, ConfigValueType, type SerializedBotConfig } from '@/siobot/BotConfig';
import type {
  ConfigBinaryValue,
  ConfigBooleanValue,
  ConfigNumberValue,
  ConfigStringValue,
} from '@/siobot/BotConfig';

export type OptionEntry = { key: keyof BotConfig; values: unknown[] };
export type OptionVariant = Partial<Record<keyof BotConfig, unknown>>;
export type OptionDimension = {
  size: number;
  getVariant: (index: number) => OptionVariant;
};

// The responsibility for this class is to permutate different configurations for the backtester and ConfigOptimizer
export class ConfigPermutator {
  private botConfig: BotConfig = new BotConfig();
  private readonly baseSerializedConfig: SerializedBotConfig;

  constructor(botConfig: BotConfig) {
    this.botConfig = botConfig;
    this.baseSerializedConfig = botConfig.getSerializedConfig();
  }

  /**
   * Generate all configurations eagerly. This can explode combinatorially; prefer
   * iterateConfigurations() for large search spaces.
   */
  public generateConfigurations(limit?: number): BotConfig[] {
    const configs: BotConfig[] = [];
    for (const config of this.iterateConfigurations(limit)) {
      configs.push(config);
    }
    return configs;
  }

  /**
   * Estimate total number of combinations without materialising them.
   */
  public estimateTotalConfigurations(): number {
    return this.buildOptionDimensions().reduce((acc, dimension) => acc * dimension.size, 1);
  }

  /**
   * Streaming generator of configurations to avoid holding everything in memory.
   */
  public *iterateConfigurations(limit?: number): IterableIterator<BotConfig> {
    const optionDimensions = this.buildOptionDimensions();
    if (optionDimensions.length === 0) {
      return;
    }

    const indices = Array(optionDimensions.length).fill(0);
    let produced = 0;
    const withinLimit = () => limit === undefined || produced < limit;

    while (withinLimit()) {
      const serialized: SerializedBotConfig = {};
      for (let i = 0; i < optionDimensions.length; i++) {
        Object.assign(serialized, optionDimensions[i]!.getVariant(indices[i]!));
      }
      const cfg = new BotConfig({ defaultSerializedConfig: this.baseSerializedConfig });
      cfg.setSerializedConfig(serialized);
      produced++;
      yield cfg;

      // Increment indices (mixed radix counter)
      let position = optionDimensions.length - 1;
      while (position >= 0) {
        indices[position]!++;
        if (indices[position]! < optionDimensions[position]!.size) {
          break;
        }
        indices[position] = 0;
        position--;
      }
      if (position < 0) {
        break; // completed the full cartesian product
      }
    }
  }

  /**
   * Sample random configurations without enumerating the full cartesian product.
   */
  public sampleRandom(count: number): BotConfig[] {
    const optionDimensions = this.buildOptionDimensions();
    const configs: BotConfig[] = [];

    for (let i = 0; i < count; i++) {
      const serialized: SerializedBotConfig = {};
      for (const dimension of optionDimensions) {
        Object.assign(serialized, dimension.getVariant(Math.floor(Math.random() * dimension.size)));
      }
      const cfg = new BotConfig({ defaultSerializedConfig: this.baseSerializedConfig });
      cfg.setSerializedConfig(serialized);
      configs.push(cfg);
    }

    return configs;
  }

  public getOptionMatrix(): OptionEntry[] {
    return this.buildOptionMatrix();
  }

  public getOptionDimensions(): OptionDimension[] {
    return this.buildOptionDimensions();
  }

  public normalizeSerializedConfig(serializedConfig: SerializedBotConfig): SerializedBotConfig {
    const normalized: SerializedBotConfig = { ...serializedConfig };
    const moduleGroups = this.buildModuleGroups(this.buildOptionMatrix());

    for (const module of moduleGroups) {
      const enabledValue =
        (normalized as any)[module.enabled.key] ?? this.getPrimitiveConfigValue(module.enabled.key);

      if (enabledValue === true) {
        continue;
      }

      for (const child of module.children) {
        (normalized as any)[child.key] = this.getPrimitiveConfigValue(child.key);
      }
    }

    return normalized;
  }

  private buildOptionMatrix(): OptionEntry[] {
    const entries: OptionEntry[] = [];

    for (const key of Object.keys(this.botConfig) as Array<keyof BotConfig>) {
      if (!this.shouldPermuteKey(key)) {
        continue;
      }

      const value = this.botConfig[key];

      if (this.isNumberConfig(value)) {
        const values = value.optimize ? this.buildNumericRange(value) : [value.value];
        entries.push({ key, values });
        continue;
      }

      if (this.isStringConfig(value)) {
        const values = value.optimize ? [...new Set(value.values)] : [value.value];
        entries.push({ key, values });
        continue;
      }

      if (this.isBooleanConfig(value)) {
        const values = value.optimize ? [value.value, !value.value] : [value.value];
        entries.push({ key, values });
        continue;
      }

      if (this.isBinaryConfig(value)) {
        const values = value.optimize ? this.buildBinaryRange(value) : [value.value];
        entries.push({ key, values });
        continue;
      }

      entries.push({ key, values: [value] });
    }

    return entries;
  }

  private buildOptionDimensions(): OptionDimension[] {
    const entries = this.buildOptionMatrix();
    const moduleGroups = this.buildModuleGroups(entries);
    const consumedKeys = new Set<keyof BotConfig>();
    const dimensions: OptionDimension[] = [];

    for (const module of moduleGroups) {
      consumedKeys.add(module.enabled.key);
      module.children.forEach((child) => consumedKeys.add(child.key));
    }

    for (const key of Object.keys(this.botConfig) as Array<keyof BotConfig>) {
      const module = moduleGroups.find((group) => group.enabled.key === key);
      if (module) {
        dimensions.push(this.createModuleDimension(module.enabled, module.children));
        continue;
      }

      if (consumedKeys.has(key)) {
        continue;
      }

      const entry = entries.find((candidate) => candidate.key === key);
      if (!entry) {
        continue;
      }

      dimensions.push(this.createSingleKeyDimension(entry));
    }

    return dimensions;
  }

  private buildModuleGroups(entries: OptionEntry[]): Array<{
    enabled: OptionEntry;
    children: OptionEntry[];
  }> {
    const enabledEntries = entries.filter((entry) => this.getModulePrefix(entry.key) !== null);

    return enabledEntries.map((enabled) => {
      const prefix = this.getModulePrefix(enabled.key)!;
      const childPrefix = `${prefix}_`;
      const children = entries.filter(
        (entry) => entry.key !== enabled.key && String(entry.key).startsWith(childPrefix)
      );

      return { enabled, children };
    });
  }

  private createSingleKeyDimension(entry: OptionEntry): OptionDimension {
    return {
      size: entry.values.length,
      getVariant: (index) => ({ [entry.key]: entry.values[index]! } as OptionVariant),
    };
  }

  private createModuleDimension(enabled: OptionEntry, children: OptionEntry[]): OptionDimension {
    const childCombinations = this.countEntryCombinations(children);
    const size = enabled.values.reduce<number>(
      (acc, enabledValue) => acc + (enabledValue === true ? childCombinations : 1),
      0
    );

    return {
      size,
      getVariant: (index) => this.getModuleVariant(enabled, children, childCombinations, index),
    };
  }

  private getModuleVariant(
    enabled: OptionEntry,
    children: OptionEntry[],
    childCombinations: number,
    variantIndex: number
  ): OptionVariant {
    let index = variantIndex;

    for (const enabledValue of enabled.values) {
      const sizeForEnabledValue = enabledValue === true ? childCombinations : 1;
      if (index >= sizeForEnabledValue) {
        index -= sizeForEnabledValue;
        continue;
      }

      const variant: OptionVariant = { [enabled.key]: enabledValue } as OptionVariant;
      if (enabledValue === true) {
        Object.assign(variant, this.decodeEntryCombination(children, index));
      } else {
        for (const child of children) {
          (variant as any)[child.key] = this.getPrimitiveConfigValue(child.key);
        }
      }
      return variant;
    }

    throw new Error(`Invalid option variant index ${variantIndex} for ${String(enabled.key)}`);
  }

  private decodeEntryCombination(entries: OptionEntry[], combinationIndex: number): OptionVariant {
    const variant: OptionVariant = {};
    let index = combinationIndex;

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!;
      const valueIndex = index % entry.values.length;
      (variant as any)[entry.key] = entry.values[valueIndex]!;
      index = Math.floor(index / entry.values.length);
    }

    return variant;
  }

  private countEntryCombinations(entries: OptionEntry[]): number {
    return entries.reduce((acc, entry) => acc * entry.values.length, 1);
  }

  private getModulePrefix(key: keyof BotConfig): string | null {
    const stringKey = String(key);
    const enabledSuffix = '_Enabled';

    if (!stringKey.endsWith(enabledSuffix)) {
      return null;
    }

    const value = this.botConfig[key];
    if (!this.isBooleanConfig(value)) {
      return null;
    }

    return stringKey.slice(0, -enabledSuffix.length);
  }

  private getPrimitiveConfigValue(key: keyof BotConfig): unknown {
    const baseValue = (this.baseSerializedConfig as any)[key];
    if (baseValue !== undefined) {
      return baseValue;
    }

    const configValue = this.botConfig[key];
    if (configValue && typeof configValue === 'object' && 'value' in configValue) {
      return (configValue as { value: unknown }).value;
    }

    return configValue;
  }

  private shouldPermuteKey(key: keyof BotConfig): boolean {
    // This setting defines the live optimizer lookback window but does not affect
    // a candidate's evaluated backtest once start/end timestamps are fixed.
    return key !== 'configOptimizerLoopBackHours';
  }

  private buildBinaryRange(config: ConfigBinaryValue): number[] {
    const values: number[] = [];
    const totalCombinations = 1 << config.bits; // 2^length combinations

    for (let i = 0; i < totalCombinations; i++) {
      values.push(i);
    }

    return values;
  }

  private buildNumericRange(config: ConfigNumberValue): number[] {
    if (config.step === 0) {
      throw new Error(`Step for ${config} cannot be zero`);
    }

    const values: number[] = [];
    const ascending = config.to >= config.from;
    const step = Math.abs(config.step);

    if (ascending) {
      for (let current = config.from; current <= config.to + 1e-12; current += step) {
        values.push(Number(current.toFixed(12)));
      }
    } else {
      for (let current = config.from; current >= config.to - 1e-12; current -= step) {
        values.push(Number(current.toFixed(12)));
      }
    }

    return values;
  }

  private isNumberConfig(value: any): value is ConfigNumberValue {
    return value?.type === ConfigValueType.NUMBER;
  }

  private isStringConfig(value: any): value is ConfigStringValue {
    return value?.type === ConfigValueType.STRING;
  }

  private isBooleanConfig(value: any): value is ConfigBooleanValue {
    return value?.type === ConfigValueType.BOOLEAN;
  }

  private isBinaryConfig(value: any): value is ConfigBinaryValue {
    return value?.type === ConfigValueType.BINARY;
  }
}
