import fs from 'fs';
import path from 'path';
import { config } from '@/config';
import { ensureFolderInPath } from '@/utils/folders';
import { logger } from '@/utils/logger';
import type { JournalData } from './types';
import { getAllPositionHistory } from '@/utils/db/positionHistory/getAllPositionHistory';
import { buildJournalData } from './utils/dataTransformer';
import { stylesTemplate, appTemplate, htmlTemplate } from './templates';

/**
 * Journal Generator - creates static HTML trading journal
 */
export class JournalGenerator {
  private outputDir: string;
  private logger: typeof logger = logger;

  constructor() {
    this.outputDir = config.journal.dir;
  }

  /**
   * Write static assets (CSS, JS) to output directory using embedded templates
   */
  private writeStaticAssets(): void {
    const cssDest = path.join(this.outputDir, 'styles.css');
    const jsDest = path.join(this.outputDir, 'app.js');

    fs.writeFileSync(cssDest, stylesTemplate, 'utf-8');
    fs.writeFileSync(jsDest, appTemplate, 'utf-8');
  }

  /**
   * Generate the index.html file with embedded data
   */
  private generateIndexHtml(journalData: JournalData): void {
    const html = htmlTemplate.replace('{{journalDataJSON}}', JSON.stringify(journalData, null, 2));

    const outputPath = path.join(this.outputDir, 'index.html');
    fs.writeFileSync(outputPath, html, 'utf-8');
  }

  /**
   * Main regeneration method - queries DB, calculates metrics, generates files
   * @param force - If true, bypasses the config.journal.enabled check
   */
  public async regenerate(force: boolean = false): Promise<void> {
    if (!force && !config.journal.enabled) {
      return;
    }

    try {
      // Ensure output directory exists
      ensureFolderInPath(this.outputDir, { withNoFile: true });

      // Fetch positions from database
      const positions = await getAllPositionHistory();

      // Build journal data
      const journalData = buildJournalData(positions);

      // Write static assets
      this.writeStaticAssets();

      // Generate HTML with embedded data
      this.generateIndexHtml(journalData);

      // Write data.json for backup/debug
      const dataJsonPath = path.join(this.outputDir, 'data.json');
      fs.writeFileSync(dataJsonPath, JSON.stringify(journalData, null, 2), 'utf-8');
      this.logger.debug(`Journal regenerated at ${this.outputDir}/index.html`);
    } catch (error) {
      this.logger.error(`Failed to regenerate journal: ${(error as Error).message}`);
      throw error;
    }
  }
}
