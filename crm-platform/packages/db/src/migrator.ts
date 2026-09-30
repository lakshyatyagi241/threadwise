import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

/**
 * Migration runner for hand-written SQL.
 *
 * Deliberately small and boring — migrations are the one thing that must work
 * identically on a laptop, in CI, and at 2am on production.
 *
 * Behaviour:
 *   - files apply in filename order, each inside its own transaction
 *   - a file whose first line is `-- @no-transaction` runs outside one
 *     (required for CREATE INDEX CONCURRENTLY and ALTER TYPE ... ADD VALUE)
 *   - every applied file's sha256 is recorded; editing an applied migration
 *     is refused, because the database and the repo would silently disagree
 *   - a session advisory lock serialises concurrent runners (two app
 *     instances booting at once must not race)
 */

const MIGRATIONS_DIR = resolve(__dirname, '../migrations');
const LOCK_KEY = 4_271_993_001; // arbitrary, stable across deploys

export interface MigrationFile {
  id: string;
  path: string;
  sql: string;
  checksum: string;
  noTransaction: boolean;
}

export interface AppliedMigration {
  id: string;
  checksum: string;
  appliedAt: Date;
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const path = join(dir, file);
      const sql = readFileSync(path, 'utf8');
      return {
        id: file.replace(/\.sql$/, ''),
        path,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16),
        noTransaction: /^\s*--\s*@no-transaction/m.test(sql.split('\n')[0] ?? ''),
      };
    });
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL
    )
  `);
}

async function getApplied(client: Client): Promise<Map<string, AppliedMigration>> {
  const { rows } = await client.query<{ id: string; checksum: string; applied_at: Date }>(
    'SELECT id, checksum, applied_at FROM _migrations ORDER BY id',
  );
  return new Map(
    rows.map((r) => [r.id, { id: r.id, checksum: r.checksum, appliedAt: r.applied_at }]),
  );
}

export interface RunMigrationsResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(
  databaseUrl: string,
  opts: { dir?: string; log?: (msg: string) => void } = {},
): Promise<RunMigrationsResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const files = loadMigrations(opts.dir);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const result: RunMigrationsResult = { applied: [], skipped: [] };

  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);

    for (const file of files) {
      const already = applied.get(file.id);

      if (already) {
        if (already.checksum !== file.checksum) {
          throw new Error(
            `Migration ${file.id} has changed since it was applied ` +
              `(recorded ${already.checksum}, file ${file.checksum}).\n` +
              `Applied migrations are immutable — add a new migration instead.`,
          );
        }
        result.skipped.push(file.id);
        continue;
      }

      const startedAt = Date.now();
      log(`  applying ${file.id}${file.noTransaction ? ' (no transaction)' : ''}`);

      if (file.noTransaction) {
        await client.query(file.sql);
      } else {
        await client.query('BEGIN');
        try {
          await client.query(file.sql);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }

      await client.query(
        'INSERT INTO _migrations (id, checksum, duration_ms) VALUES ($1, $2, $3)',
        [file.id, file.checksum, Date.now() - startedAt],
      );
      result.applied.push(file.id);
    }

    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

export interface MigrationStatusRow {
  id: string;
  state: 'applied' | 'pending' | 'modified' | 'missing-file';
  appliedAt?: Date;
}

export async function migrationStatus(
  databaseUrl: string,
  opts: { dir?: string } = {},
): Promise<MigrationStatusRow[]> {
  const files = loadMigrations(opts.dir);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);
    const rows: MigrationStatusRow[] = files.map((f) => {
      const a = applied.get(f.id);
      if (!a) return { id: f.id, state: 'pending' };
      return {
        id: f.id,
        state: a.checksum === f.checksum ? 'applied' : 'modified',
        appliedAt: a.appliedAt,
      };
    });

    // Applied in the database but gone from the repo — someone deleted a
    // migration file. Surface it rather than pretending it never existed.
    const fileIds = new Set(files.map((f) => f.id));
    for (const id of applied.keys()) {
      if (!fileIds.has(id)) rows.push({ id, state: 'missing-file' });
    }

    return rows.sort((a, b) => a.id.localeCompare(b.id));
  } finally {
    await client.end();
  }
}

/** Drops and recreates the public schema. Development only — guarded by the CLI. */
export async function resetDatabase(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}
