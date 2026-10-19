import { BotConfig, ConfigValueType } from '@/siobot/BotConfig';
import type {
  ConfigBinaryValue,
  ConfigBooleanValue,
  ConfigNumberValue,
  ConfigStringValue,
  SerializedBotConfig,
} from '@/siobot/BotConfig';
import type { EvaluationResult } from './types';
import { ConfigPermutator, type OptionDimension, type OptionEntry } from './ConfigPermutator';
import { consoleLogger as logger } from '@/utils/logger';

// #################################################################
// # Explanation
// #################################################################

/**
 * Parameter,Analogy in Nature,What it means for the Algorithm,Why you use it
populationSize (300),The total number of animals in the environment.,How many potential solutions (chromosomes/individuals) the algorithm keeps track of in each generation.,A larger population explores more options but takes longer to compute. A smaller one might miss the best answer.
generations (15),How many complete breeding cycles/years the evolution runs for.,"The maximum number of iterations (cycles of selection, crossover, and mutation) the algorithm will run before stopping.",It controls how long the algorithm tries to find a solution. More generations mean more time to improve.
eliteCount (15),The best 15 animals that are guaranteed to breed and pass on their genes.,The number of best-performing solutions from the current generation that are copied directly into the next generation without any changes.,"This ensures the best solution found so far is never lost, guaranteeing that the overall solution quality either stays the same or improves."
mutationRate (0.25),"The chance that a baby is born with a random, slight change in its DNA (e.g., a slightly different eye color).","The probability that a selected solution will have some of its ""genes"" (parameters) randomly changed after reproduction.","It helps the algorithm explore new areas of the solution space. A high rate prevents the population from getting stuck, but can destroy good solutions."
crossoverRate (0.85),The chance that two animals will mix their DNA to create a baby (reproduce).,"The probability that two selected ""parent"" solutions will combine their genetic material to create new ""offspring"" solutions.",It's the primary way good solutions are combined and improved. A high rate (like 0.85) means combining is preferred over simple copying.
tournamentSize (4),"To choose a partner, we randomly pick 4 animals and the strongest one wins the right to breed.","The number of solutions randomly selected from the population to compete. The best solution among the group wins and becomes a ""parent.""","A larger size increases ""selection pressure,"" meaning only the very best solutions survive to breed, leading to faster but less diverse convergence."
convergenceLimit (20),Stop the experiment if the quality of the best animal hasn't improved for 20 years.,The number of consecutive generations the algorithm is allowed to run without an improvement in the fitness of the best solution before it automatically stops.,Prevents the algorithm from wasting time when it has likely found the best answer it can.
diversityThreshold (0.25),"If the animals start looking too much alike (less than 25% difference), something needs to change.","A measure of how different the solutions in the population are from each other. If it drops below this value, it means the population is too uniform.",It's a trigger for the adaptive mutation strategy (see below).
adaptiveMutation (true),"If all the animals look the same, we increase the chance of a random mutation to shake things up.","When the algorithm detects a lack of diversity (i.e., when diversity drops below diversityThreshold), it increases the mutationRate temporarily.","This is a smart trick to prevent the population from getting stuck in a local optimum (a good, but not the best, solution)."
crossoverType ('two-point'),How the two parents' DNA is cut and pasted together.,"Defines the method used to mix the ""genes"" of the two parents during crossover. Two-point crossover is a common technique that involves selecting two random points to swap segments.",Different types work better for different problems. Two-point is often robust for optimization problems.
mutationStrength (0.12),"When a mutation occurs, this is the size of the change in the DNA (e.g., how much taller the animal gets).","For problems with numeric parameters, this often dictates the magnitude of the random change applied to a single ""gene"" during mutation.",Controls how big the step is when a mutation happens. A smaller value makes for fine-tuning; a larger value allows for bigger jumps.
 */

export type GeneticAlgorithmParams = {
  populationSize: number;
  generations: number;
  eliteCount: number;
  mutationRate: number;
  crossoverRate: number;
  tournamentSize: number;
  convergenceLimit: number;
  // New parameters for improved optimization
  diversityThreshold: number; // Minimum diversity ratio to maintain
  adaptiveMutation: boolean; // Enable adaptive mutation rates
  crossoverType: 'single-point' | 'uniform' | 'two-point';
  mutationStrength: number; // Per-gene mutation probability (0-1)
  searchSpaceSize?: number; // Estimated size of the search space
};

export type GeneticAlgorithmConstructorParams = GeneticAlgorithmParams & {
  botConfig: BotConfig;
};

type Gene = {
  key: keyof BotConfig;
  value: unknown;
  bounds?: { from: number; to: number };
  options?: unknown[];
  numericOptions?: number[];
};

/**
 * Genetic Algorithm for optimizing bot configurations.
 * Uses tournament selection, single-point crossover, and Gaussian mutation.
 */
export class GeneticAlgorithm {
  private botConfig: BotConfig;
  private params: GeneticAlgorithmParams;
  private geneSchema: Gene[] = [];
  private currentMutationRate: number; // Adaptive mutation rate
  private optionMatrix: OptionEntry[] = [];
  private optionDimensions: OptionDimension[] = [];
  private searchSpaceSize: number;
  private configPermutator: ConfigPermutator;

  constructor(params: GeneticAlgorithmConstructorParams) {
    this.params = {
      populationSize: params.populationSize,
      generations: params.generations,
      eliteCount: params.eliteCount,
      mutationRate: params.mutationRate,
      crossoverRate: params.crossoverRate,
      tournamentSize: params.tournamentSize,
      convergenceLimit: params.convergenceLimit,
      diversityThreshold: params.diversityThreshold,
      adaptiveMutation: params.adaptiveMutation,
      crossoverType: params.crossoverType,
      mutationStrength: params.mutationStrength,
    };

    this.botConfig = params.botConfig;

    this.configPermutator = new ConfigPermutator(this.botConfig);
    this.optionMatrix = this.configPermutator.getOptionMatrix();
    this.optionDimensions = this.configPermutator.getOptionDimensions();

    this.currentMutationRate = this.params.mutationRate;
    this.buildGeneSchema();
    this.searchSpaceSize = this.optionDimensions.reduce(
      (acc, dimension) => acc * Math.max(1, dimension.size),
      1
    );
    logger.info(
      `🧬 GeneticAlgorithm: Search space ≈ ${this.searchSpaceSize} combinations (sampling without precomputing).`
    );
  }

  public getParams(): GeneticAlgorithmParams {
    return { ...this.params, searchSpaceSize: this.searchSpaceSize };
  }

  /**
   * Generate initial random population
   */
  public generateInitialPopulation(seedConfigs: SerializedBotConfig[] = []): BotConfig[] {
    return this.createPopulation(this.params.populationSize, seedConfigs);
  }

  /**
   * Generate a random population of specified size (for boundary discovery)
   */
  public generateRandomPopulation(size: number): BotConfig[] {
    return this.createPopulation(size);
  }

  /**
   * Evolve population to next generation using:
   * - Elitism: keep best individuals
   * - Tournament selection
   * - Crossover and mutation
   * - Diversity preservation
   */
  public evolve(population: EvaluationResult[]): BotConfig[] {
    const sortedPopulation = [...population].sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));

    const nextGeneration: BotConfig[] = [];

    // Elitism: keep best individuals unchanged
    for (let i = 0; i < this.params.eliteCount && i < sortedPopulation.length; i++) {
      const elite = new BotConfig({
        defaultSerializedConfig: this.botConfig.getSerializedConfig(),
      });
      elite.setSerializedConfig(this.normalizeSerializedConfig(sortedPopulation[i]!.config));
      nextGeneration.push(elite);
    }

    // Adaptive mutation: increase mutation rate if diversity is low
    if (this.params.adaptiveMutation) {
      const diversity = this.calculateDiversity(sortedPopulation);
      if (diversity < this.params.diversityThreshold) {
        // Increase mutation rate when diversity is low
        this.currentMutationRate = Math.min(0.8, this.params.mutationRate * 2);
      } else {
        // Gradually return to normal mutation rate
        this.currentMutationRate = Math.max(
          this.params.mutationRate,
          this.currentMutationRate * 0.95
        );
      }
    }

    // Fill rest of population through selection, crossover, and mutation
    while (nextGeneration.length < this.params.populationSize) {
      const parent1 = this.tournamentSelection(sortedPopulation);
      const parent2 = this.tournamentSelection(sortedPopulation);

      let offspring: BotConfig;
      if (Math.random() < this.params.crossoverRate) {
        offspring = this.crossover(parent1, parent2);
      } else {
        // Copy parent1 if no crossover
        offspring = new BotConfig({
          defaultSerializedConfig: this.botConfig.getSerializedConfig(),
        });
        offspring.setSerializedConfig(this.normalizeSerializedConfig(parent1.config));
      }

      if (Math.random() < this.currentMutationRate) {
        this.mutate(offspring);
      }

      // Ensure offspring is valid by snapping to nearest valid configuration
      this.snapToValidConfig(offspring);

      nextGeneration.push(offspring);
    }

    // Inject random individuals to maintain diversity
    const randomInjectionCount = Math.floor(this.params.populationSize * 0.05); // 5% random injection
    for (
      let i = 0;
      i < randomInjectionCount &&
      nextGeneration.length > this.params.eliteCount + randomInjectionCount;
      i++
    ) {
      const replaceIndex =
        this.params.eliteCount +
        Math.floor(Math.random() * (nextGeneration.length - this.params.eliteCount));
      nextGeneration[replaceIndex] = this.createRandomIndividual();
    }

    return nextGeneration;
  }

  /**
   * Calculate population diversity based on unique configurations
   */
  private calculateDiversity(population: EvaluationResult[]): number {
    const uniqueConfigs = new Set<string>();
    for (const individual of population) {
      uniqueConfigs.add(this.getConfigHash(individual.config));
    }
    return uniqueConfigs.size / population.length;
  }

  /**
   * Generate a simple hash for a configuration to detect duplicates
   */
  private getConfigHash(config: SerializedBotConfig): string {
    const normalizedConfig = this.normalizeSerializedConfig(config);
    const relevantValues: string[] = [];
    for (const gene of this.geneSchema) {
      if (gene.bounds || gene.options) {
        const value = this.extractGeneValue(normalizedConfig, gene.key);
        relevantValues.push(`${gene.key}:${value}`);
      }
    }
    return relevantValues.join('|');
  }

  private normalizeSerializedConfig(config: SerializedBotConfig): SerializedBotConfig {
    return this.configPermutator.normalizeSerializedConfig(config);
  }

  private createPopulation(size: number, seedConfigs: SerializedBotConfig[] = []): BotConfig[] {
    const population: BotConfig[] = [];
    const seen = new Set<string>();
    const maxUnique = Math.min(size, this.searchSpaceSize);

    for (const seedConfig of seedConfigs) {
      if (population.length >= size) {
        break;
      }

      const normalizedSeedConfig = this.normalizeSerializedConfig(seedConfig);
      const hash = this.getConfigHash(normalizedSeedConfig);
      if (seen.has(hash)) {
        continue;
      }

      const seeded = new BotConfig({ defaultSerializedConfig: this.botConfig.getSerializedConfig() });
      seeded.setSerializedConfig(normalizedSeedConfig);
      population.push(seeded);
      seen.add(hash);
    }

    let attempts = 0;
    const uniqueAttemptLimit = Math.max(maxUnique * 20, 100);
    while (population.length < maxUnique && attempts < uniqueAttemptLimit) {
      const individual = this.createRandomIndividual();
      const hash = this.getConfigHash(individual.getSerializedConfig());
      attempts++;

      if (seen.has(hash)) {
        continue;
      }

      population.push(individual);
      seen.add(hash);
    }

    while (population.length < size) {
      population.push(this.createRandomIndividual());
    }

    return population;
  }

  /**
   * Extract a primitive value from either a serialized config or a BotConfig instance.
   * The evaluator stores full BotConfig objects, so crossover must peel off `.value`.
   */
  private extractGeneValue(config: SerializedBotConfig, key: keyof BotConfig): unknown {
    const rawValue = (config as any)[key];
    if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
      return (rawValue as { value: unknown }).value;
    }
    return rawValue;
  }

  /**
   * Snap offspring to nearest valid configuration from the pre-generated set
   * This ensures all individuals are within the valid search space
   */
  private snapToValidConfig(individual: BotConfig): void {
    const serialized = individual.getSerializedConfig();

    for (const gene of this.geneSchema) {
      const currentValue = (serialized as any)[gene.key];

      if (gene.numericOptions && gene.numericOptions.length > 0) {
        // Find nearest valid numeric value
        let nearestValue = gene.numericOptions[0]!;
        let minDistance = Math.abs(currentValue - nearestValue);

        for (const option of gene.numericOptions) {
          const distance = Math.abs(currentValue - option);
          if (distance < minDistance) {
            minDistance = distance;
            nearestValue = option;
          }
        }
        (serialized as any)[gene.key] = nearestValue;
      }
    }

    individual.setSerializedConfig(this.normalizeSerializedConfig(serialized));
  }

  /**
   * Build schema of genes that can be optimized
   */
  private buildGeneSchema(): void {
    for (const entry of this.optionMatrix) {
      const key = entry.key;
      const value = this.botConfig[key] as unknown;

      if (this.isNumberConfig(value) && value.optimize) {
        this.geneSchema.push({
          key,
          value: value.value,
          bounds: { from: value.from, to: value.to },
          numericOptions: this.buildNumericRange(value.from, value.to, value.step),
        });
        continue;
      }

      if (this.isStringConfig(value) && value.optimize) {
        this.geneSchema.push({
          key,
          value: value.value,
          options: [...new Set(value.values)],
        });
        continue;
      }

      if (this.isBooleanConfig(value) && value.optimize) {
        this.geneSchema.push({
          key,
          value: value.value,
          options: [true, false],
        });
        continue;
      }

      if (this.isBinaryConfig(value) && value.optimize) {
        this.geneSchema.push({
          key,
          value: value.value,
          options: this.buildBinaryRange(value),
        });
        continue;
      }

      // Non-optimized genes use default value
      this.geneSchema.push({
        key,
        value,
      });
    }
  }

  /**
   * Create a random individual by selecting from pre-generated configurations
   */
  private createRandomIndividual(): BotConfig {
    const serialized: SerializedBotConfig = {};
    for (const dimension of this.optionDimensions) {
      Object.assign(serialized, dimension.getVariant(Math.floor(Math.random() * dimension.size)));
    }

    const config = new BotConfig({ defaultSerializedConfig: this.botConfig.getSerializedConfig() });
    config.setSerializedConfig(this.normalizeSerializedConfig(serialized));
    return config;
  }

  /**
   * Tournament selection: pick best of k random individuals
   * Uses sampling without replacement for better diversity
   */
  private tournamentSelection(population: EvaluationResult[]): EvaluationResult {
    const tournamentSize = Math.min(this.params.tournamentSize, population.length);
    const indices = new Set<number>();

    // Sample without replacement for fair tournament
    while (indices.size < tournamentSize) {
      indices.add(Math.floor(Math.random() * population.length));
    }

    let best: EvaluationResult | null = null;
    for (const index of indices) {
      const candidate = population[index]!;
      if (!best || (candidate.fitness ?? 0) > (best.fitness ?? 0)) {
        best = candidate;
      }
    }

    return best!;
  }

  /**
   * Crossover: combine two parents using the configured crossover type
   */
  private crossover(parent1: EvaluationResult, parent2: EvaluationResult): BotConfig {
    switch (this.params.crossoverType) {
      case 'uniform':
        return this.uniformCrossover(parent1, parent2);
      case 'two-point':
        return this.twoPointCrossover(parent1, parent2);
      case 'single-point':
      default:
        return this.singlePointCrossover(parent1, parent2);
    }
  }

  /**
   * Single-point crossover: combine two parents at a random point
   */
  private singlePointCrossover(parent1: EvaluationResult, parent2: EvaluationResult): BotConfig {
    const config = new BotConfig({ defaultSerializedConfig: this.botConfig.getSerializedConfig() });
    const serialized: SerializedBotConfig = {};

    const crossoverPoint = Math.floor(Math.random() * this.geneSchema.length);

    for (let i = 0; i < this.geneSchema.length; i++) {
      const gene = this.geneSchema[i]!;
      const parentConfig = i < crossoverPoint ? parent1.config : parent2.config;
      (serialized as any)[gene.key] = this.extractGeneValue(parentConfig, gene.key);
    }

    config.setSerializedConfig(this.normalizeSerializedConfig(serialized));
    return config;
  }

  /**
   * Two-point crossover: swap genes between two random points
   */
  private twoPointCrossover(parent1: EvaluationResult, parent2: EvaluationResult): BotConfig {
    const config = new BotConfig({ defaultSerializedConfig: this.botConfig.getSerializedConfig() });
    const serialized: SerializedBotConfig = {};

    let point1 = Math.floor(Math.random() * this.geneSchema.length);
    let point2 = Math.floor(Math.random() * this.geneSchema.length);
    if (point1 > point2) [point1, point2] = [point2, point1];

    for (let i = 0; i < this.geneSchema.length; i++) {
      const gene = this.geneSchema[i]!;
      const parentConfig = i >= point1 && i < point2 ? parent2.config : parent1.config;
      (serialized as any)[gene.key] = this.extractGeneValue(parentConfig, gene.key);
    }

    config.setSerializedConfig(this.normalizeSerializedConfig(serialized));
    return config;
  }

  /**
   * Uniform crossover: each gene is randomly taken from either parent
   * Generally better for parameter optimization problems
   */
  private uniformCrossover(parent1: EvaluationResult, parent2: EvaluationResult): BotConfig {
    const config = new BotConfig({ defaultSerializedConfig: this.botConfig.getSerializedConfig() });
    const serialized: SerializedBotConfig = {};

    for (const gene of this.geneSchema) {
      const parentConfig = Math.random() < 0.5 ? parent1.config : parent2.config;
      (serialized as any)[gene.key] = this.extractGeneValue(parentConfig, gene.key);
    }

    config.setSerializedConfig(this.normalizeSerializedConfig(serialized));
    return config;
  }

  /**
   * Mutation: randomly modify genes by selecting from valid discrete options
   * Uses configurable per-gene mutation probability
   */
  private mutate(individual: BotConfig): void {
    const serialized = individual.getSerializedConfig();
    const mutationStrength = this.params.mutationStrength;

    for (const gene of this.geneSchema) {
      // Each gene has a chance to mutate based on mutationStrength
      if (Math.random() < mutationStrength) {
        if (gene.numericOptions && gene.numericOptions.length > 0) {
          // For numeric options, sometimes do a "creep" mutation (nearby value)
          // and sometimes a random jump
          if (Math.random() < 0.7) {
            // Creep mutation: move to adjacent value
            const currentValue = (serialized as any)[gene.key] as number;
            const currentIndex = gene.numericOptions.indexOf(currentValue);
            if (currentIndex !== -1) {
              const direction = Math.random() < 0.5 ? -1 : 1;
              const newIndex = Math.max(
                0,
                Math.min(gene.numericOptions.length - 1, currentIndex + direction)
              );
              (serialized as any)[gene.key] = gene.numericOptions[newIndex];
            } else {
              // Value not found, select random
              const randomIndex = Math.floor(Math.random() * gene.numericOptions.length);
              (serialized as any)[gene.key] = gene.numericOptions[randomIndex];
            }
          } else {
            // Random jump mutation
            const randomIndex = Math.floor(Math.random() * gene.numericOptions.length);
            (serialized as any)[gene.key] = gene.numericOptions[randomIndex];
          }
        } else if (gene.options && gene.options.length > 0) {
          // Random new option for categorical values
          const randomIndex = Math.floor(Math.random() * gene.options.length);
          (serialized as any)[gene.key] = gene.options[randomIndex];
        }
      }
    }

    individual.setSerializedConfig(this.normalizeSerializedConfig(serialized));
  }

  /**
   * Build a range of numeric values from start to end with given step
   */
  private buildNumericRange(from: number, to: number, step: number): number[] {
    if (step === 0) {
      return [from];
    }

    const values: number[] = [];
    const ascending = to >= from;
    const absStep = Math.abs(step);

    if (ascending) {
      for (let current = from; current <= to + 1e-12; current += absStep) {
        values.push(Number(current.toFixed(12)));
      }
    } else {
      for (let current = from; current >= to - 1e-12; current -= absStep) {
        values.push(Number(current.toFixed(12)));
      }
    }

    return values;
  }

  private buildBinaryRange(config: ConfigBinaryValue): number[] {
    const values: number[] = [];
    const totalCombinations = 1 << config.bits; // 2^length combinations

    for (let i = 0; i < totalCombinations; i++) {
      values.push(i);
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
