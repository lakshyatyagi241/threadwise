import { Inject, Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { Tx } from '@crm/db';
import { INST_ENV, type InstEnv } from '../../config/domains/install-update-licensing.env';
import {
  buildMigrationReport,
  readMigrationFiles,
  type MigrationFileFact,
  type MigrationReport,
} from './migration-report';
import { SetupRepository } from './setup.repository';

/**
 * Which migrations the database has applied versus which this build ships (TW-INST-012 verified, -024, -025).
 * Read-only: running migrations stays a deploy step (`pnpm db:migrate`), never an HTTP request.
 */
@Injectable()
export class MigrationStateService {
  private readonly logger = new Logger(MigrationStateService.name);
  private files: MigrationFileFact[] | null | undefined;

  constructor(
    private readonly repo: SetupRepository,
    @Inject(INST_ENV) private readonly env: InstEnv,
  ) {}

  /** Loaded once: the files of a running build do not change. null = this build does not ship them. */
  private loadFiles(): MigrationFileFact[] | null {
    if (this.files !== undefined) return this.files;
    const dir =
      this.env.MIGRATIONS_DIR ??
      resolve(dirname(createRequire(__filename).resolve('@crm/db')), '../migrations');
    try {
      this.files = existsSync(dir) ? readMigrationFiles(dir) : null;
    } catch (err) {
      this.logger.warn(`cannot read migration files from ${dir}: ${(err as Error).message}`);
      this.files = null;
    }
    return this.files;
  }

  /** Whether this build ships its migration files (the Requirements screen lists it as a readable directory). */
  shipped(): boolean {
    return this.loadFiles() !== null;
  }

  async report(tx: Tx): Promise<MigrationReport> {
    return buildMigrationReport(this.loadFiles(), await this.repo.ledger(tx));
  }
}
