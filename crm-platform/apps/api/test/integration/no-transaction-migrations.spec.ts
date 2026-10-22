import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * Rerunning a `@no-transaction` migration after a crash, and migrating a clean database from zero.
 *
 * A CONCURRENTLY statement cannot share a transaction with its _migrations record, so a crash between the two leaves the index
 * built and the file unrecorded. These cases pin what the runner does then: a VALID index is adopted (IF NOT EXISTS skips the
 * build, the file is recorded and the later migrations run); an INVALID leftover of this file's own index stops the run before
 * the file, naming the recovery; an INVALID index the file does not build blocks nothing; a clean database still migrates.
 */

const REAL_DIR = resolve(__dirname, '../../../../packages/db/migrations');
// The badge migrations and the autovacuum change after them, as they sit in packages/db/migrations.
const BADGE_FILES = [
  '20270323090000_conversations_live_badges_idx.sql',
  '20270323090100_conversations_archived_badges_idx.sql',
  '20270323090200_conversations_autovacuum.sql',
];
const LONG = 180_000;
const quiet = { log: () => undefined };

const idsIn = (dir: string): string[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => f.replace(/\.sql$/, ''));

describe('@no-transaction migrations rerun safely', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let workRoot: string;

  const databaseUrl = (name: string): string => {
    const url = new URL(container.getConnectionUri());
    url.pathname = `/${name}`;
    return url.toString();
  };

  async function createDatabase(name: string): Promise<string> {
    await owner.query(`CREATE DATABASE ${name}`);
    return databaseUrl(name);
  }

  async function connect(name: string): Promise<Client> {
    const client = new Client({ connectionString: databaseUrl(name) });
    await client.connect();
    return client;
  }

  function fixtureDir(name: string): string {
    const dir = join(workRoot, name);
    mkdirSync(dir);
    return dir;
  }

  function writeProbeMigrations(dir: string): void {
    writeFileSync(
      join(dir, '0002_probe_index.sql'),
      '-- @no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx_probe_x\n  ON probe (x);\n',
    );
    writeFileSync(join(dir, '0003_probe_after.sql'), 'CREATE TABLE probe_after (x integer);\n');
  }

  async function recordedIds(db: Client): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM _migrations ORDER BY id');
    return rows.map((r) => r.id);
  }

  async function invalidIndexes(db: Client): Promise<string[]> {
    const { rows } = await db.query<{ name: string }>(
      `SELECT c.relname AS name
         FROM pg_index ix
         JOIN pg_class c ON c.oid = ix.indexrelid
        WHERE NOT ix.indisvalid
        ORDER BY 1`,
    );
    return rows.map((r) => r.name);
  }

  async function tableExists(db: Client, name: string): Promise<boolean> {
    const { rows } = await db.query<{ exists: boolean }>(
      'SELECT to_regclass($1) IS NOT NULL AS exists',
      [name],
    );
    return rows[0]?.exists === true;
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    workRoot = mkdtempSync(join(tmpdir(), 'no-tx-migrations-'));
  }, 180_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
    rmSync(workRoot, { recursive: true, force: true });
  });

  it(
    'a valid index left by a run that stopped before its record is adopted: the file is recorded and the later migrations run',
    async () => {
      // Every file before the badge migrations, so the crash point below is exactly where a real run would stop.
      const beforeDir = fixtureDir('before-badges');
      for (const file of readdirSync(REAL_DIR)) {
        if (file.endsWith('.sql') && !BADGE_FILES.includes(file)) {
          copyFileSync(join(REAL_DIR, file), join(beforeDir, file));
        }
      }
      const url = await createDatabase('adopt_valid_index');
      await runMigrations(url, { dir: beforeDir, ...quiet });

      const db = await connect('adopt_valid_index');
      try {
        // The crash point: the first badge statement committed, its _migrations row did not.
        await db.query(readFileSync(join(REAL_DIR, BADGE_FILES[0]), 'utf8'));
        expect(await recordedIds(db)).not.toContain(BADGE_FILES[0].replace(/\.sql$/, ''));

        const result = await runMigrations(url, { dir: REAL_DIR, ...quiet });

        expect(result.applied).toEqual(BADGE_FILES.map((f) => f.replace(/\.sql$/, '')));
        expect(await invalidIndexes(db)).toEqual([]);
        // The autovacuum migration came after the index: its settings prove it ran in this rerun.
        const { rows } = await db.query<{ reloptions: string[] | null }>(
          `SELECT reloptions FROM pg_class WHERE relname = 'conversations'`,
        );
        expect(rows[0]?.reloptions).toContain('autovacuum_vacuum_scale_factor=0.01');
      } finally {
        await db.end();
      }
    },
    LONG,
  );

  it('an INVALID index this file builds stops the run before the file, names the recovery, and the recovery reruns it', async () => {
    const dir = fixtureDir('invalid-leftover');
    writeFileSync(join(dir, '0001_probe.sql'), 'CREATE TABLE probe (x integer NOT NULL);\n');
    const url = await createDatabase('invalid_leftover');
    await runMigrations(url, { dir, ...quiet });
    writeProbeMigrations(dir);

    const db = await connect('invalid_leftover');
    try {
      await db.query('INSERT INTO probe VALUES (1), (1)');
      // A unique build over duplicate rows fails, and CONCURRENTLY leaves idx_probe_x behind INVALID.
      await expect(
        db.query('CREATE UNIQUE INDEX CONCURRENTLY idx_probe_x ON probe (x)'),
      ).rejects.toThrow();
      expect(await invalidIndexes(db)).toEqual(['idx_probe_x']);

      await expect(runMigrations(url, { dir, ...quiet })).rejects.toThrow(
        /idx_probe_x is INVALID[\s\S]*DROP INDEX CONCURRENTLY idx_probe_x;/,
      );
      // Nothing of the refused file ran.
      expect(await recordedIds(db)).toEqual(['0001_probe']);
      expect(await tableExists(db, 'probe_after')).toBe(false);

      // The recovery the message names, then a rerun.
      await db.query('DROP INDEX CONCURRENTLY idx_probe_x');
      const result = await runMigrations(url, { dir, ...quiet });
      expect(result.applied).toEqual(['0002_probe_index', '0003_probe_after']);
      expect(await invalidIndexes(db)).toEqual([]);
    } finally {
      await db.end();
    }
  });

  it('an INVALID index this file does not build does not block it', async () => {
    const dir = fixtureDir('unrelated-invalid');
    writeFileSync(join(dir, '0001_probe.sql'), 'CREATE TABLE probe (x integer NOT NULL);\n');
    const url = await createDatabase('unrelated_invalid');
    await runMigrations(url, { dir, ...quiet });
    writeProbeMigrations(dir);

    const db = await connect('unrelated_invalid');
    try {
      await db.query('INSERT INTO probe VALUES (1), (1)');
      await expect(
        db.query('CREATE UNIQUE INDEX CONCURRENTLY probe_other_idx ON probe (x)'),
      ).rejects.toThrow();

      const result = await runMigrations(url, { dir, ...quiet });

      expect(result.applied).toEqual(['0002_probe_index', '0003_probe_after']);
      // The other index belongs to some other build: left as it is.
      expect(await invalidIndexes(db)).toEqual(['probe_other_idx']);
    } finally {
      await db.end();
    }
  });

  it(
    'a clean database still migrates from zero, and a rerun applies nothing',
    async () => {
      const url = await createDatabase('from_zero');

      const result = await runMigrations(url, { dir: REAL_DIR, ...quiet });

      expect(result.applied).toEqual(idsIn(REAL_DIR));
      expect(result.skipped).toEqual([]);
      const db = await connect('from_zero');
      try {
        expect(await invalidIndexes(db)).toEqual([]);
        const again = await runMigrations(url, { dir: REAL_DIR, ...quiet });
        expect(again.applied).toEqual([]);
        expect(again.skipped).toEqual(idsIn(REAL_DIR));
      } finally {
        await db.end();
      }
    },
    LONG,
  );
});
