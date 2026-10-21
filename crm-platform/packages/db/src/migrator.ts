import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { migrationChecksum, recordedChecksumMatches } from './checksum';

/**
 * Migration runner for hand-written SQL.
 *
 * Deliberately small and boring — migrations are the one thing that must work
 * identically on a laptop, in CI, and at 2am on production.
 *
 * Behaviour:
 *   - files apply in filename order, each inside its own transaction
 *   - a file whose first line is `-- @no-transaction` runs outside one
 *     (required for CREATE INDEX CONCURRENTLY and ALTER TYPE ... ADD VALUE).
 *     Its statement and its record are two steps, so a crash between them
 *     leaves the statement applied and unrecorded: such a file must be safe
 *     to rerun (CREATE INDEX CONCURRENTLY IF NOT EXISTS). Before it runs, the
 *     runner refuses while an index the file itself builds is INVALID, so
 *     IF NOT EXISTS never skips a failed build
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
        checksum: migrationChecksum(sql),
        noTransaction: /^\s*--\s*@no-transaction/m.test(sql.split('\n')[0] ?? ''),
      };
    });
}

const CONCURRENT_INDEX =
  /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:[A-Za-z_]\w*|"[^"]+")\s*\.\s*)?("[^"]+"|[A-Za-z_]\w*)/gi;

/**
 * Names of the indexes a file builds with CREATE INDEX CONCURRENTLY, read from its SQL with comments removed. Only these are
 * checked before the file runs: an INVALID index elsewhere in the database belongs to some other build.
 */
function concurrentIndexNames(sql: string): string[] {
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
  const names = new Set<string>();
  for (const match of code.matchAll(CONCURRENT_INDEX)) {
    const token = match[1] ?? '';
    names.add(token.startsWith('"') ? token.slice(1, -1) : token.toLowerCase());
  }
  return [...names];
}

/**
 * A failed or interrupted CONCURRENTLY build leaves its index INVALID, and IF NOT EXISTS would skip that name without a word.
 * The runner does not drop it (that would hide the failure): it stops before the statement and names the recovery. Nothing of
 * the file has run at that point.
 */
async function assertNoInvalidIndex(client: Client, file: MigrationFile): Promise<void> {
  const names = concurrentIndexNames(file.sql);
  if (names.length === 0) return;
  const { rows } = await client.query<{ name: string }>(
    `SELECT c.relname AS name
       FROM pg_index ix
       JOIN pg_class c ON c.oid = ix.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT ix.indisvalid AND n.nspname = current_schema() AND c.relname = ANY($1::text[])`,
    [names],
  );
  if (rows.length === 0) return;
  const recovery = rows.map((r) => `DROP INDEX CONCURRENTLY ${r.name};`).join(' ');
  throw new Error(
    `Migration ${file.id} did not run: ${rows.map((r) => r.name).join(', ')} ` +
      `${rows.length === 1 ? 'is' : 'are'} INVALID, left by a CONCURRENTLY build that failed or was interrupted.\n` +
      `Recovery, then rerun the migration: ${recovery}\n` +
      `If the build is still running (pg_stat_progress_create_index), wait for it instead.`,
  );
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
        if (!recordedChecksumMatches(already.checksum, file.sql)) {
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
        await assertNoInvalidIndex(client, file);
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
        state: recordedChecksumMatches(a.checksum, f.sql) ? 'applied' : 'modified',
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
