import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SetupRequirementsResponse } from '@crm/contracts';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { PlatformStore } from '../auth';
import { MigrationStateService } from './migration-state.service';
import { SetupRepository } from './setup.repository';

/** Node.js floor, the same as the repo's `engines.node`. */
export const NODE_MIN_MAJOR = 22;

/** Native or heavyweight packages the API cannot serve a request without (WaDesk's list of PHP extensions). */
export const REQUIRED_MODULES = [
  'pg',
  'ioredis',
  'bullmq',
  'drizzle-orm',
  '@node-rs/argon2',
  'socket.io',
  'nodemailer',
  'pino',
] as const;

/** Extensions the migrations create; without them the first migration fails. */
export const REQUIRED_DB_EXTENSIONS = ['citext', 'pg_trgm', 'pgcrypto', 'vector'] as const;

/** Pure: `v22.3.0` -> 22. */
export function nodeMajor(version: string): number {
  return Number.parseInt(version.replace(/^v/, ''), 10);
}

/**
 * The pre-flight check (WD-INST-004): the same panels as WaDesk's Requirements screen, answered for this stack.
 * Evaluated on every call (no caching) so fixing the server and refreshing is the loop, as in WaDesk. Unlike WaDesk,
 * the result gates the install run itself on the server, not only the page's Continue button.
 */
@Injectable()
export class RequirementsService {
  constructor(
    private readonly store: PlatformStore,
    private readonly repo: SetupRepository,
    private readonly migrations: MigrationStateService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<SetupRequirementsResponse> {
    const version = process.version;
    const runtime = {
      version: version.replace(/^v/, ''),
      required: `${NODE_MIN_MAJOR}`,
      ok: nodeMajor(version) >= NODE_MIN_MAJOR,
    };

    const modules = REQUIRED_MODULES.map((key) => ({ key, ok: canResolve(key) }));

    const facts = await this.databaseFacts();
    const redisOk = await this.redis
      .ping()
      .then(() => true)
      .catch(() => false);
    const services = [
      { key: 'database', ok: facts.reachable },
      { key: 'redis', ok: redisOk },
      { key: 'migrations', ok: facts.migrationsOk },
      { key: 'permissions', ok: facts.permissionsOk },
    ];

    const directories = [
      { key: 'temp', ok: await writableTempDir() },
      { key: 'migrations', ok: this.migrations.shipped() },
    ];

    const extensionsOk = REQUIRED_DB_EXTENSIONS.every((e) => facts.extensions.includes(e));
    const database = {
      engine: facts.reachable ? 'postgresql' : null,
      version: facts.version,
      extensions: facts.extensions,
      ok: facts.reachable && extensionsOk,
    };

    const allPassed =
      runtime.ok && [...modules, ...services, ...directories].every((t) => t.ok) && database.ok;
    return { runtime, modules, services, directories, database, allPassed };
  }

  private async databaseFacts() {
    try {
      return await this.store.tx(async (tx) => {
        const [v, ext, report, defs] = await Promise.all([
          tx.execute(sql`SHOW server_version`),
          tx.execute(sql`SELECT extname FROM pg_extension ORDER BY extname`),
          this.migrations.report(tx),
          this.repo.permissionDefCount(tx),
        ]);
        const migrationsOk =
          report.status === 'unknown' ? report.appliedCount > 0 : report.status === 'current';
        return {
          reachable: true,
          version: (v.rows[0] as { server_version: string }).server_version.split(' ')[0] ?? null,
          extensions: (ext.rows as Array<{ extname: string }>).map((r) => r.extname),
          migrationsOk,
          permissionsOk: defs > 0,
        };
      });
    } catch {
      return {
        reachable: false,
        version: null,
        extensions: [] as string[],
        migrationsOk: false,
        permissionsOk: false,
      };
    }
  }
}

function canResolve(name: string): boolean {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

/** Writes and removes a directory under the OS temp dir: what upload staging needs. */
export async function writableTempDir(): Promise<boolean> {
  try {
    const dir = await mkdtemp(join(tmpdir(), 'setup-check-'));
    await rm(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
