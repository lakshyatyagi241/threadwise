import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { migrationChecksum, recordedChecksumMatches } from './checksum';
import { indexStates } from './index-state';

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
 *     runner checks each index it names: an INVALID or still-building one
 *     stops the run, and a valid one is adopted only if its definition is the
 *     one the file builds
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

/**
 * Removes comments from migration SQL. Quoted strings and identifiers are copied as they are, so a `--` or a block-comment marker
 * inside them is text: a name such as "a -- b" is still seen.
 */
function sqlCode(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i] ?? '';
    if (ch === '-' && sql[i + 1] === '-') {
      const eol = sql.indexOf('\n', i);
      i = eol === -1 ? sql.length : eol;
    } else if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      out += ' ';
      i = end === -1 ? sql.length : end + 2;
    } else if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === ch && sql[j + 1] !== ch)) j += sql[j] === ch ? 2 : 1;
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_]\w*)`;
// The one statement shape the runner can read. A CREATE INDEX CONCURRENTLY written any other way is refused, never skipped.
const CREATE_CONCURRENT = new RegExp(
  String.raw`\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(IF\s+NOT\s+EXISTS\s+)?(${IDENT})\s+ON\s+(${IDENT})`,
  'gi',
);
const ANY_CREATE_CONCURRENT = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi;

interface IndexBuild {
  name: string; // the catalog name
  nameToken: string; // as the file writes it, so the probe spells it the same way
  unique: boolean;
  ifNotExists: boolean;
  rest: string; // the statement after its table name, up to the semicolon
}

const unquote = (token: string): string =>
  token.startsWith('"') ? token.slice(1, -1).replace(/""/g, '"') : token.toLowerCase();

/** The indexes a file builds with CREATE INDEX CONCURRENTLY. A statement the runner cannot read stops the run. */
function indexBuilds(sql: string): IndexBuild[] {
  const code = sqlCode(sql);
  const matches = [...code.matchAll(CREATE_CONCURRENT)];
  if (matches.length !== (code.match(ANY_CREATE_CONCURRENT) ?? []).length) {
    throw new Error(
      'Cannot read the index name of a CREATE INDEX CONCURRENTLY statement. Write it as ' +
        '`CREATE INDEX CONCURRENTLY [IF NOT EXISTS] <name> ON <table> (...)` with an unqualified table.',
    );
  }
  return matches.map((m) => ({
    name: unquote(m[3] ?? ''),
    nameToken: m[3] ?? '',
    unique: m[1] !== undefined,
    ifNotExists: m[2] !== undefined,
    rest: code.slice((m.index ?? 0) + m[0].length).split(';')[0] ?? '',
  }));
}

/** pg_get_indexdef names the table it is on; that part differs between the probe and the real index, so it is dropped. */
const withoutTable = (definition: string): string =>
  definition.replace(/ ON \S+ USING /, ' ON _ USING ');

/**
 * The definition the file's statement gives its index, read from an empty temporary copy of the table and then rolled back.
 * Nothing is built on the real table: the copy has the same columns, so the expressions and predicate resolve the same way.
 */
async function definitionOfStatement(
  client: Client,
  build: IndexBuild,
  table: string,
): Promise<string> {
  await client.query('BEGIN');
  try {
    await client.query(`CREATE TEMP TABLE migration_index_probe (LIKE ${table})`);
    await client.query(
      `CREATE ${build.unique ? 'UNIQUE ' : ''}INDEX ${build.nameToken} ON migration_index_probe ${build.rest}`,
    );
    const { rows } = await client.query<{ definition: string }>(
      `SELECT pg_get_indexdef(i.indexrelid) AS definition
         FROM pg_index i
        WHERE i.indrelid = 'migration_index_probe'::regclass`,
    );
    return rows[0]?.definition ?? '';
  } finally {
    await client.query('ROLLBACK');
  }
}

/**
 * Before a @no-transaction file runs, checks every index it names that already exists. An INVALID one (a failed or interrupted
 * CONCURRENTLY build) stops the run; so does one still being built by another session. A VALID one is adopted by IF NOT EXISTS
 * only when its definition is the one this file builds: a same-named index of any other shape is never recorded as this migration.
 * Each refusal names the recovery. Nothing from the file has run when it throws.
 */
async function checkIndexesBeforeRun(client: Client, file: MigrationFile): Promise<void> {
  const builds = indexBuilds(file.sql);
  if (builds.length === 0) return;
  const problems: string[] = [];
  for (const ix of await indexStates(
    client,
    builds.map((b) => b.name),
  )) {
    if (!ix.valid) {
      problems.push(
        ix.building
          ? `index ${ix.name} is still being built by another session: wait for it to finish, then rerun the migration.`
          : `index ${ix.name} is INVALID, left by a CONCURRENTLY build that failed or was interrupted. ` +
              `Recovery: DROP INDEX CONCURRENTLY ${ix.quoted}; then rerun the migration.`,
      );
      continue;
    }
    const build = builds.find((b) => b.name === ix.name);
    // Without IF NOT EXISTS the statement itself fails on the name, which is loud already.
    if (!build?.ifNotExists) continue;
    const expected = await definitionOfStatement(client, build, ix.table);
    if (withoutTable(expected) !== withoutTable(ix.definition)) {
      problems.push(
        `index ${ix.name} already exists and is valid, but its definition is not the one this migration builds ` +
          `(${ix.definition}). It is not adopted. If it is not wanted: DROP INDEX CONCURRENTLY ${ix.quoted}; then rerun the migration.`,
      );
    }
  }
  if (problems.length === 0) return;
  throw new Error(
    `Migration ${file.id} did not run. Nothing from this file ran.\n${problems.join('\n')}`,
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
        await checkIndexesBeforeRun(client, file);
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
