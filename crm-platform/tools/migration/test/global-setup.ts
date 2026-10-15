import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDbClient } from '../../../packages/db/src/client';

/**
 * One scratch Postgres for the whole run:
 *  - MIGRATION_TEST_ADMIN_URL set: use that server (superuser URL to any database), nothing is started or removed;
 *  - otherwise `docker run pgvector/pgvector:pg16` under a unique name on a free host port, removed at the end.
 * Then: create the app login roles, migrate ONE template database with the repo's migrations, and let every test file clone it.
 */
const REPO = resolve(__dirname, '../../..');
const TEMPLATE = 'crm_mig_tpl';
let container: string | null = null;

const docker = (...args: string[]): string =>
  execFileSync('docker', args, { encoding: 'utf8' }).trim();

async function waitReady(url: string): Promise<void> {
  const started = Date.now();
  for (;;) {
    const c = createDbClient({ url, poolMax: 1 });
    try {
      await c.db.execute(sql`select 1`);
      await c.close();
      return;
    } catch (e) {
      await c.close().catch(() => undefined);
      if (Date.now() - started > 90_000) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export default async function setup({
  provide,
}: {
  provide: (k: string, v: string) => void;
}): Promise<() => Promise<void>> {
  let adminUrl = process.env.MIGRATION_TEST_ADMIN_URL ?? '';
  if (!adminUrl) {
    container = `crm-migtool-test-${process.pid}-${Date.now() % 100000}`;
    docker(
      'run',
      '-d',
      '--name',
      container,
      '-e',
      'POSTGRES_USER=crm',
      '-e',
      'POSTGRES_PASSWORD=crm',
      '-e',
      'POSTGRES_DB=postgres',
      '-p',
      '127.0.0.1::5432',
      'pgvector/pgvector:pg16',
    );
    const port = docker('port', container, '5432/tcp').split('\n')[0]!.split(':').pop();
    adminUrl = `postgres://crm:crm@127.0.0.1:${port}/postgres`;
  }
  await waitReady(adminUrl);

  const admin = createDbClient({ url: adminUrl, poolMax: 2 });
  try {
    // the same two login roles docker/postgres/init creates
    await admin.db.execute(
      sql.raw(readFileSync(join(REPO, 'docker/postgres/init/01-app-roles.sql'), 'utf8')),
    );
    const have = await admin.db.execute(sql`select 1 from pg_database where datname = ${TEMPLATE}`);
    if (have.rows.length === 0 || !process.env.MIGRATION_TEST_REUSE_TEMPLATE) {
      await admin.db.execute(sql.raw(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`));
      await admin.db.execute(sql.raw(`CREATE DATABASE ${TEMPLATE}`));
      const dbDir = join(REPO, 'packages/db');
      const tsx = join(dbDir, 'node_modules/tsx/dist/cli.mjs');
      if (!existsSync(tsx))
        throw new Error(
          'packages/db/node_modules/tsx is missing: run pnpm install in crm-platform',
        );
      execFileSync(process.execPath, [tsx, 'src/cli/migrate.ts', 'up'], {
        cwd: dbDir,
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: adminUrl.replace(/\/[^/]*$/, `/${TEMPLATE}`),
          NODE_ENV: 'test',
        },
        stdio: 'pipe',
      });
    }
  } finally {
    await admin.close();
  }
  provide('adminUrl', adminUrl);
  provide('template', TEMPLATE);

  return async () => {
    if (container) {
      try {
        // -v also deletes the image's anonymous data volume; without it every suite run leaks one (~0.4 GB).
        docker('rm', '-f', '-v', container);
      } catch {
        /* already gone */
      }
    }
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
    template: string;
  }
}
