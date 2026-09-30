#!/usr/bin/env tsx
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { loadMigrations, migrationStatus, resetDatabase, runMigrations } from '../migrator';

// Repo root .env — one file for the API, the worker and this CLI.
loadEnv({ path: resolve(__dirname, '../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

/**
 * Migrations run as the OWNER, not as the application role: they need
 * CREATE EXTENSION, table ownership and the ability to create roles. The
 * application deliberately connects as a restricted non-superuser so that RLS
 * actually applies to it.
 */
function databaseUrl(): string {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set. Copy .env.example to .env first.',
    );
    process.exit(1);
  }
  return url;
}

function assertNotProduction(command: string): void {
  if (process.env.NODE_ENV === 'production') {
    console.error(`refusing to run "${command}" with NODE_ENV=production`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const [command = 'up', ...rest] = process.argv.slice(2);

  switch (command) {
    case 'up': {
      const result = await runMigrations(databaseUrl(), { dir: MIGRATIONS_DIR });
      if (result.applied.length === 0) {
        console.log(`up to date (${result.skipped.length} migrations already applied)`);
      } else {
        console.log(`applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`);
      }
      break;
    }

    case 'status': {
      const rows = await migrationStatus(databaseUrl(), { dir: MIGRATIONS_DIR });
      for (const row of rows) {
        const when = row.appliedAt ? row.appliedAt.toISOString() : '';
        console.log(`${row.state.padEnd(13)} ${row.id}  ${when}`);
      }
      const bad = rows.filter((r) => r.state === 'modified' || r.state === 'missing-file');
      if (bad.length > 0) {
        console.error(`\n${bad.length} migration(s) diverged from the database.`);
        process.exit(1);
      }
      break;
    }

    case 'new': {
      const name = rest.join('-').replace(/[^a-zA-Z0-9-_]/g, '');
      if (!name) {
        console.error('usage: pnpm db:new <name>   e.g. pnpm db:new inbox_conversations');
        process.exit(1);
      }
      const existing = loadMigrations(MIGRATIONS_DIR);
      const lastNumber = existing.length
        ? Number.parseInt(existing[existing.length - 1]!.id.slice(0, 4), 10)
        : 0;
      const id = `${String(lastNumber + 1).padStart(4, '0')}_${name}`;
      const path = join(MIGRATIONS_DIR, `${id}.sql`);
      writeFileSync(
        path,
        `-- ${id}\n` +
          `-- Why this migration exists (not what it does — the SQL says that):\n` +
          `--\n` +
          `-- Uncomment on the FIRST line if this needs CREATE INDEX CONCURRENTLY\n` +
          `-- or ALTER TYPE ... ADD VALUE, neither of which can run in a transaction:\n` +
          `-- @no-transaction\n\n`,
      );
      console.log(`created ${path}`);
      break;
    }

    case 'reset': {
      assertNotProduction('reset');
      await resetDatabase(databaseUrl());
      const result = await runMigrations(databaseUrl(), { dir: MIGRATIONS_DIR });
      console.log(`reset complete — applied ${result.applied.length} migration(s)`);
      break;
    }

    default:
      console.error(`unknown command "${command}". Use: up | status | new <name> | reset`);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
