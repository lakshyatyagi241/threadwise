import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  readAll,
  readBytes,
  type ArchiveObject,
  type ArchiveStorage,
} from '../../../src/infra/providers/data-retention/archive-storage.port';
import { LocalArchiveStorage } from '../../../src/infra/providers/data-retention/local-archive-storage.adapter';
import { ArchiveReader } from '../../../src/modules/data-retention/archive-reader.service';
import { RetentionWorker } from '../../../src/modules/data-retention/retention.worker';
import {
  PartitionArchiver,
  type ArchiveManifest,
} from '../../../src/modules/data-retention/partition-archiver.service';
import type { StreamPolicy } from '../../../src/modules/data-retention/retention-policies';

/**
 * The archiver against a real Postgres, as the role the worker really connects as (crm_worker_user: owns no table, so the drop only works
 * through the SECURITY DEFINER drop_closed_partition). Each test gets its own synthetic stream so tests never see each other's
 * partitions. Months are relative to the real clock because the database function refuses a month that closed less than 7 days ago.
 */
const ORGS = [7, 9, 11];
const STREAMS = Array.from({ length: 14 }, (_, i) => `zz_t${i + 1}`);

/** Counts calls and lets a test act at a precise point of the archiver's sequence. */
class HookedStorage implements ArchiveStorage {
  puts: string[] = [];
  afterManifest: (() => Promise<void>) | null = null;
  failObjectReads = false;
  constructor(readonly inner: LocalArchiveStorage) {}
  async putFile(key: string, path: string) {
    this.puts.push(key);
    await this.inner.putFile(key, path);
  }
  async putBytes(key: string, data: Buffer) {
    this.puts.push(key);
    await this.inner.putBytes(key, data);
    if (key.endsWith('_manifest.json') && this.afterManifest) await this.afterManifest();
  }
  async openRead(key: string) {
    if (this.failObjectReads && key.endsWith('.ndjson.gz')) throw new Error('storage unreachable');
    return this.inner.openRead(key);
  }
  list(prefix: string): Promise<ArchiveObject[]> {
    return this.inner.list(prefix);
  }
  listDirs(prefix: string) {
    return this.inner.listDirs(prefix);
  }
  delete(key: string) {
    return this.inner.delete(key);
  }
  deletePrefix(prefix: string) {
    return this.inner.deletePrefix(prefix);
  }
}

describe('PartitionArchiver', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let clients: DbClientPair;
  let dir: string;
  let storage: HookedStorage;
  let archiver: PartitionArchiver;

  const workerUrl = () =>
    `postgres://crm_worker_user:test@${container.getHost()}:${container.getPort()}/crm`;

  /** `YYYY-MM` of the UTC month `k` months before the current one. */
  const monthAgo = (k: number): string => {
    const d = new Date();
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const policyOf = (stream: string): StreamPolicy => ({
    stream,
    partitionKey: 'recorded_at',
    idColumn: 'id',
    orgColumn: 'org_id',
    liveDays: 40,
    archiveDays: null,
    omitColumns: ['contact_id'],
  });
  const partOf = (stream: string, month: string) => `${stream}_${month.replace('-', '')}`;

  async function makeStream(stream: string, months: string[]): Promise<void> {
    await owner.query(`
      CREATE SEQUENCE ${stream}_id_seq;
      CREATE TABLE ${stream} (
        id          bigint      NOT NULL DEFAULT nextval('${stream}_id_seq'),
        org_id      bigint      NOT NULL,
        recorded_at timestamptz NOT NULL,
        contact_id  bigint,
        n           integer     NOT NULL,
        PRIMARY KEY (id, recorded_at)
      ) PARTITION BY RANGE (recorded_at);
      ALTER TABLE ${stream} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${stream} FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON ${stream} FOR ALL
        USING (org_id = current_org_id() OR app_is_privileged())
        WITH CHECK (org_id = current_org_id() OR app_is_privileged());
      CREATE TABLE ${stream}_default PARTITION OF ${stream} DEFAULT;
      SELECT inherit_partition_rls('${stream}_default');
    `);
    for (const m of months) {
      await owner.query(`SELECT ensure_monthly_partition($1::regclass, $2::date)`, [
        stream,
        `${m}-01`,
      ]);
    }
  }

  /** `count` rows spread over the three orgs, alternating, with microsecond timestamps, inside the month. */
  async function seed(stream: string, month: string, count: number): Promise<void> {
    await owner.query(
      `INSERT INTO ${stream} (org_id, recorded_at, contact_id, n)
       SELECT (ARRAY[7,9,11])[g % 3 + 1],
              ($1::timestamptz + g * interval '1 minute' + interval '123456 microseconds'),
              g, g
         FROM generate_series(1, $2::int) g`,
      [`${month}-01T00:00:00Z`, count],
    );
  }

  async function rowsIn(relation: string): Promise<number> {
    const { rows } = await owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${relation}`);
    return rows[0]!.n;
  }
  async function partitionsOf(stream: string): Promise<string[]> {
    const { rows } = await owner.query<{ name: string }>(
      `SELECT child.relname AS name FROM pg_inherits i
         JOIN pg_class child ON child.oid = i.inhrelid
         JOIN pg_class par ON par.oid = i.inhparent
        WHERE par.relname = $1 ORDER BY child.relname`,
      [stream],
    );
    return rows.map((r) => r.name);
  }

  async function readLines(key: string): Promise<Array<Record<string, unknown>>> {
    const stream = await storage.openRead(key);
    expect(stream, key).not.toBeNull();
    const text = gunzipSync(await readAll(stream!, 64 * 1024 * 1024)).toString('utf8');
    return text
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }
  async function readManifest(stream: string, month: string): Promise<ArchiveManifest> {
    const bytes = await readBytes(storage, `archive/${stream}/${month}/_manifest.json`);
    expect(bytes).not.toBeNull();
    return JSON.parse(bytes!.toString('utf8')) as ArchiveManifest;
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    for (const role of ['crm_app_user', 'crm_worker_user']) {
      await owner.query(
        `CREATE ROLE ${role} LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
      );
    }
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    // What a later phase's migration does for its own stream: name the synthetic streams as archivable.
    await owner.query(
      `CREATE OR REPLACE FUNCTION archivable_streams() RETURNS text[] LANGUAGE sql STABLE
         SET search_path = public, pg_temp
       AS $$ SELECT ARRAY['an_events', ${STREAMS.map((s) => `'${s}'`).join(', ')}]::text[] $$`,
    );
    clients = createDbClientPair({ url: workerUrl(), poolMax: 3 });
    dir = await mkdtemp(join(tmpdir(), 'archiver-'));
  }, 240_000);

  afterAll(async () => {
    await clients?.close();
    await owner?.end();
    await container?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  async function fresh(): Promise<void> {
    storage = new HookedStorage(new LocalArchiveStorage(await mkdtemp(join(dir, 's-'))));
    archiver = new PartitionArchiver(new DatabaseService(clients), storage, { batchRows: 250 });
  }

  it('archives and drops every closed month, keeps the open ones, and writes exact objects', async () => {
    await fresh();
    const s = 'zz_t1';
    const [m5, m4, m3, m1] = [monthAgo(5), monthAgo(4), monthAgo(3), monthAgo(1)];
    await makeStream(s, [m5, m4, m3, m1, monthAgo(0)]);
    for (const m of [m5, m4, m3, m1]) await seed(s, m, 900);

    // Ordered by the numeric column: an output column called `id` would make ORDER BY sort the text.
    const before = await owner.query<{ id: string; org_id: string; n: number }>(
      `SELECT t.id::text AS id, t.org_id::text AS org_id, t.n FROM ${partOf(s, m5)} t ORDER BY t.id`,
    );
    const results = await archiver.archiveEligible(policyOf(s));

    expect(results.map((r) => [r.month, r.status])).toEqual([
      [m5, 'dropped'],
      [m4, 'dropped'],
      [m3, 'dropped'],
    ]);
    const left = await partitionsOf(s);
    expect(left).toContain(partOf(s, m1));
    expect(left).toContain(partOf(s, monthAgo(0)));
    for (const m of [m5, m4, m3]) expect(left).not.toContain(partOf(s, m));
    expect(await rowsIn(partOf(s, m1))).toBe(900);

    // Objects: one per org, rows exactly as stored, without the personal link, microseconds intact.
    const manifest = await readManifest(s, m5);
    expect(manifest.totalRows).toBe(900);
    expect(Object.keys(manifest.orgs).sort()).toEqual(['11', '7', '9']);
    let seen = 0;
    for (const org of ORGS) {
      const lines = await readLines(`archive/${s}/${m5}/${org}.ndjson.gz`);
      const expected = before.rows.filter((r) => r.org_id === String(org));
      expect(lines.map((l) => String(l.id))).toEqual(expected.map((r) => r.id));
      expect(lines.map((l) => l.n)).toEqual(expected.map((r) => r.n));
      for (const l of lines) {
        expect(l).not.toHaveProperty('contact_id');
        expect(String(l.recorded_at)).toMatch(/\.123456\+00:00$/);
        expect(String(l.org_id)).toBe(String(org));
      }
      const entry = manifest.orgs[String(org)]!;
      expect(entry.rows).toBe(lines.length);
      seen += lines.length;
    }
    expect(seen).toBe(900);

    // The reader returns exactly what the archiver wrote, for one workspace, across the three archived months.
    const reader = new ArchiveReader(storage, [policyOf(s)]);
    const got: string[] = [];
    for await (const r of reader.stream(
      s,
      9,
      new Date(`${m5}-01T00:00:00Z`),
      new Date(`${monthAgo(2)}-01T00:00:00Z`),
      { trusted: true },
    )) {
      expect(String(r.org_id)).toBe('9');
      got.push(String(r.id));
    }
    expect(got).toHaveLength(300 * 3); // a third of 900 rows in each of the three months
    expect(got).toEqual([...got].sort((a, b) => Number(a) - Number(b)));
  });

  it('describes each object in the manifest with its row count, hash and size', async () => {
    await fresh();
    const s = 'zz_t2';
    const m = monthAgo(4);
    await makeStream(s, [m]);
    await seed(s, m, 300);
    await archiver.archiveMonth(policyOf(s), m);

    const manifest = await readManifest(s, m);
    expect(manifest).toMatchObject({ version: 1, stream: s, month: m, totalRows: 300 });
    expect(manifest.omitted).toEqual(['contact_id']);
    expect(manifest.columns).toEqual(['id', 'org_id', 'recorded_at', 'n']);
    const listed = await storage.list(`archive/${s}/${m}/`);
    for (const [org, entry] of Object.entries(manifest.orgs)) {
      const object = listed.find((o) => o.key === `archive/${s}/${m}/${org}.ndjson.gz`);
      expect(object?.bytes).toBe(entry.bytes);
      const raw = gunzipSync(
        await readAll((await storage.openRead(`archive/${s}/${m}/${org}.ndjson.gz`))!),
      );
      expect(createHash('sha256').update(raw).digest('hex')).toBe(entry.sha256);
      expect(raw.toString('utf8').split('\n').filter(Boolean)).toHaveLength(entry.rows);
    }
  });

  it('does not drop the partition when an archived object is damaged, and a later run repairs it', async () => {
    await fresh();
    const s = 'zz_t3';
    const m = monthAgo(4);
    await makeStream(s, [m]);
    await seed(s, m, 600);
    storage.afterManifest = async () => {
      await storage.inner.putBytes(`archive/${s}/${m}/9.ndjson.gz`, Buffer.from('not gzip at all'));
    };

    const first = await archiver.archiveMonth(policyOf(s), m);
    expect(first.status).toBe('failed');
    expect(await partitionsOf(s)).toContain(partOf(s, m));
    expect(await rowsIn(partOf(s, m))).toBe(600);

    storage.afterManifest = null;
    const second = await archiver.archiveMonth(policyOf(s), m);
    expect(second.status).toBe('dropped');
    expect(await partitionsOf(s)).not.toContain(partOf(s, m));
    expect((await readLines(`archive/${s}/${m}/9.ndjson.gz`)).length).toBe(200);
  });

  it('is idempotent, and a run that died after exporting finishes the drop without exporting again', async () => {
    await fresh();
    const s = 'zz_t4';
    const m = monthAgo(4);
    await makeStream(s, [m]);
    await seed(s, m, 450);

    storage.failObjectReads = true; // the verification read fails, as a storage outage would
    await expect(archiver.archiveMonth(policyOf(s), m)).rejects.toThrow('storage unreachable');
    expect(await partitionsOf(s)).toContain(partOf(s, m));

    storage.failObjectReads = false;
    storage.puts = [];
    const resumed = await archiver.archiveMonth(policyOf(s), m);
    expect(resumed).toMatchObject({ status: 'dropped', exported: false });
    expect(storage.puts).toEqual([]);
    expect(await partitionsOf(s)).not.toContain(partOf(s, m));

    // Third run: nothing there any more.
    const again = await archiver.archiveMonth(policyOf(s), m);
    expect(again.status).toBe('absent');
    expect(storage.puts).toEqual([]);
  });

  it('never archives or drops rows in the default partition', async () => {
    await fresh();
    const s = 'zz_t5';
    const m = monthAgo(4);
    await makeStream(s, [m]);
    await seed(s, m, 90);
    // A year with no partition: the row lands in the catch-all.
    await owner.query(
      `INSERT INTO ${s} (org_id, recorded_at, contact_id, n) VALUES (7, now() - interval '3 years', 1, 1)`,
    );
    expect(await rowsIn(`${s}_default`)).toBe(1);

    await archiver.archiveEligible(policyOf(s));
    expect(await rowsIn(`${s}_default`)).toBe(1);
    expect(await partitionsOf(s)).toContain(`${s}_default`);
    const keys = (await storage.list(`archive/${s}/`)).map((o) => o.key);
    expect(keys.every((k) => k.includes(`/${m}/`))).toBe(true);
  });

  it('re-exports a month whose rows changed after the manifest was written, instead of dropping on it', async () => {
    await fresh();
    const s = 'zz_t6';
    const m = monthAgo(4);
    await makeStream(s, [m]);
    await seed(s, m, 300);
    // A row lands in the closed month between the export and the drop.
    storage.afterManifest = async () => {
      await owner.query(
        `INSERT INTO ${s} (org_id, recorded_at, contact_id, n) VALUES (7, $1::timestamptz, 1, 999)`,
        [`${m}-02T00:00:00Z`],
      );
      storage.afterManifest = null;
    };

    const first = await archiver.archiveMonth(policyOf(s), m);
    expect(first.status).toBe('failed');
    expect(await partitionsOf(s)).toContain(partOf(s, m));
    expect(await rowsIn(partOf(s, m))).toBe(301);

    storage.puts = [];
    const second = await archiver.archiveMonth(policyOf(s), m);
    expect(second).toMatchObject({ status: 'dropped', exported: true });
    expect(storage.puts.length).toBeGreaterThan(0);
    const manifest = await readManifest(s, m);
    expect(manifest.totalRows).toBe(301);
    const lines = await readLines(`archive/${s}/${m}/7.ndjson.gz`);
    expect(lines.some((l) => l.n === 999)).toBe(true);
  });

  it('removes objects of a workspace that no longer has rows when it re-exports', async () => {
    await fresh();
    const s = 'zz_t7';
    const m = monthAgo(4);
    await makeStream(s, [m]);
    await seed(s, m, 90);
    storage.afterManifest = async () => {
      // Org 9 is erased between export and drop: its rows vanish, so the drop-time recount differs.
      await owner.query(`DELETE FROM ${s} WHERE org_id = 9`);
      storage.afterManifest = null;
    };
    expect((await archiver.archiveMonth(policyOf(s), m)).status).toBe('failed');

    const second = await archiver.archiveMonth(policyOf(s), m);
    expect(second.status).toBe('dropped');
    const keys = (await storage.list(`archive/${s}/${m}/`)).map((o) => o.key);
    expect(keys).toEqual([
      `archive/${s}/${m}/11.ndjson.gz`,
      `archive/${s}/${m}/7.ndjson.gz`,
      `archive/${s}/${m}/_manifest.json`,
    ]);
  });

  it('archives an empty closed month and drops it', async () => {
    await fresh();
    const s = 'zz_t8';
    const m = monthAgo(4);
    await makeStream(s, [m]);
    const result = await archiver.archiveMonth(policyOf(s), m);
    expect(result).toMatchObject({ status: 'dropped', rows: 0 });
    expect((await readManifest(s, m)).totalRows).toBe(0);
    expect(await partitionsOf(s)).not.toContain(partOf(s, m));
  });

  it('refuses a month that is not past its live window, whatever the caller asks', async () => {
    await fresh();
    const s = 'zz_t9';
    await makeStream(s, [monthAgo(1), monthAgo(0)]);
    await seed(s, monthAgo(1), 30);
    await expect(archiver.archiveMonth(policyOf(s), monthAgo(1))).rejects.toThrow(/live window/);
    await expect(archiver.archiveMonth(policyOf(s), monthAgo(0))).rejects.toThrow(/live window/);
    expect(await rowsIn(partOf(s, monthAgo(1)))).toBe(30);
    expect(await storage.list('archive/')).toEqual([]);
  });

  it('counts a partition that another worker dropped meanwhile as done, not as an error', async () => {
    await fresh();
    const s = 'zz_t11';
    const m = monthAgo(4);
    await makeStream(s, [m]);
    await seed(s, m, 60);
    storage.afterManifest = async () => {
      await owner.query(`DROP TABLE ${partOf(s, m)}`);
    };
    expect((await archiver.archiveMonth(policyOf(s), m)).status).toBe('absent');
  });

  it('inspects partitions from the catalog without reading or changing them', async () => {
    await fresh();
    const s = 'zz_t12';
    const m = monthAgo(4);
    await makeStream(s, [m, monthAgo(1)]);
    await seed(s, m, 120);
    await owner.query(`ANALYZE ${partOf(s, m)}`);
    const info = await archiver.inspect(policyOf(s), m);
    expect(info).toMatchObject({ part: partOf(s, m), estimatedRows: 120 });
    expect(info!.bytes).toBeGreaterThan(0);
    expect(await archiver.inspect(policyOf(s), monthAgo(9))).toBeNull();
    expect(await archiver.existingMonths(policyOf(s))).toEqual([m, monthAgo(1)]);
    expect(await rowsIn(partOf(s, m))).toBe(120);
    expect(await storage.list('archive/')).toEqual([]);
  });

  it('archives the real an_events table with its production policy through the nightly job', async () => {
    await fresh();
    const m = monthAgo(4);
    await owner.query(`SELECT ensure_monthly_partition('an_events'::regclass, $1::date)`, [
      `${m}-01`,
    ]);
    // Every kind of column an event has: smallint, bigint, NULLs, a nested jsonb with awkward characters, and a person link to leave out.
    await owner.query(
      `INSERT INTO an_events (org_id, type, recorded_at, occurred_at, channel_kind, direction, status, source_kind,
                              k1, k2, channel_id, contact_id, conversation_id, campaign_id, flow_id, agent_id, template_id,
                              device_id, qty, amount_minor, duration_ms, tokens, props)
       SELECT (ARRAY[7, 9])[g % 2 + 1], 12, $1::timestamptz + g * interval '1 minute' + interval '123456 microseconds',
              $1::timestamptz + g * interval '1 minute', 1, 2, 3, 1, g::smallint, NULL, 5, 700 + g, 100 + g, NULL, 3, NULL, NULL,
              9, 2, 250, 1200, NULL,
              jsonb_build_object('a', jsonb_build_object('b', jsonb_build_array(1, 2, 'x')), 'note', 'quote " backslash \\ tab' || E'\\t' || ' end')
         FROM generate_series(1, 40) g`,
      [`${m}-01T00:00:00Z`],
    );
    const stored = await owner.query<{ id: string; contact_id: string }>(
      `SELECT t.id::text AS id, t.contact_id::text AS contact_id FROM ${partOf('an_events', m)} t WHERE t.org_id = 7 ORDER BY t.id`,
    );
    expect(stored.rows).toHaveLength(20);
    expect(stored.rows.every((r) => r.contact_id !== null)).toBe(true);

    const worker = new RetentionWorker(archiver, storage);
    const report = await worker.run({ dryRun: false });
    const anEvents = report.streams.find((s) => s.stream === 'an_events');
    expect(anEvents?.error).toBeUndefined();
    expect(anEvents?.archived?.map((r) => [r.month, r.status])).toEqual([[m, 'dropped']]);
    expect(await partitionsOf('an_events')).not.toContain(partOf('an_events', m));
    // The previous month is still inside the 60 day window and the catch-all is untouched.
    expect(await partitionsOf('an_events')).toContain('an_events_default');

    const lines = await readLines(`archive/an_events/${m}/7.ndjson.gz`);
    expect(lines.map((l) => String(l.id))).toEqual(stored.rows.map((r) => r.id));
    for (const l of lines) {
      expect(l).not.toHaveProperty('contact_id');
      expect(l).toMatchObject({
        org_id: 7,
        type: 12,
        qty: 2,
        amount_minor: 250,
        duration_ms: 1200,
        channel_id: 5,
        k2: null,
        campaign_id: null,
        tokens: null,
      });
      expect(String(l.recorded_at)).toMatch(/\.123456\+00:00$/);
      expect(l.props).toEqual({
        a: { b: [1, 2, 'x'] },
        note: 'quote " backslash \\ tab\t end',
      });
    }
    // And the reader, with the production policy list, returns the same rows.
    const back: string[] = [];
    for await (const r of new ArchiveReader(storage).stream(
      'an_events',
      7,
      new Date(`${m}-01T00:00:00Z`),
      new Date(`${monthAgo(3)}-01T00:00:00Z`),
      { trusted: true },
    )) {
      back.push(String(r.id));
    }
    expect(back).toEqual(stored.rows.map((r) => r.id));
  });

  it('stops retrying a month that failed three nights in a row, and tries again after a week', async () => {
    await fresh();
    const s = 'zz_t13';
    const m = monthAgo(4);
    await makeStream(s, [m]);
    await seed(s, m, 120);
    storage.afterManifest = async () => {
      await storage.inner.putBytes(`archive/${s}/${m}/9.ndjson.gz`, Buffer.from('not gzip at all'));
    };
    for (let night = 1; night <= 3; night += 1) {
      expect((await archiver.archiveMonth(policyOf(s), m)).status).toBe('failed');
    }

    storage.puts = [];
    const paused = await archiver.archiveMonth(policyOf(s), m);
    expect(paused.status).toBe('failed');
    expect((paused as { reason: string }).reason).toMatch(/paused after 3 failed attempts/);
    expect(storage.puts).toEqual([]); // nothing was exported or written
    expect(await rowsIn(partOf(s, m))).toBe(120);

    // A week later, with the cause gone, it runs again, finishes, and forgets the failures.
    storage.afterManifest = null;
    const later = new Date(Date.now() + 8 * 86_400_000);
    expect((await archiver.archiveMonth(policyOf(s), m, { now: later })).status).toBe('dropped');
    const keys = (await storage.list(`archive/${s}/${m}/`)).map((o) => o.key);
    expect(keys).not.toContain(`archive/${s}/${m}/_failures.json`);
  });

  it('counts a run that throws as a failed night too, and then pauses without throwing', async () => {
    await fresh();
    const s = 'zz_t14';
    const m = monthAgo(4);
    await makeStream(s, [m]);
    await seed(s, m, 60);
    storage.failObjectReads = true;
    for (let night = 1; night <= 3; night += 1) {
      await expect(archiver.archiveMonth(policyOf(s), m)).rejects.toThrow('storage unreachable');
    }
    const paused = await archiver.archiveMonth(policyOf(s), m);
    expect(paused).toMatchObject({ status: 'failed' });
    expect((paused as { reason: string }).reason).toMatch(
      /paused after 3 failed attempts.*storage unreachable/,
    );
    expect(await partitionsOf(s)).toContain(partOf(s, m));
  });

  describe('drop_closed_partition', () => {
    const call = async (client: Client, parent: string, month: string) =>
      client
        .query(`SELECT drop_closed_partition($1::regclass, $2::date) AS dropped`, [
          parent,
          `${month}-01`,
        ])
        .then(
          (r) => ({ ok: true as const, dropped: (r.rows[0] as { dropped: boolean }).dropped }),
          (e: Error) => ({ ok: false as const, error: e.message }),
        );
    let worker: Client;
    let app: Client;
    beforeAll(async () => {
      worker = new Client({ connectionString: workerUrl() });
      app = new Client({
        connectionString: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      });
      await Promise.all([worker.connect(), app.connect()]);
    });
    afterAll(async () => {
      await Promise.all([worker?.end(), app?.end()]);
    });

    it('is closed to the API role', async () => {
      const s = 'zz_t10';
      await makeStream(s, [monthAgo(4)]);
      const r = await call(app, s, monthAgo(4));
      expect(r).toMatchObject({ ok: false });
      expect((r as { error: string }).error).toMatch(/permission denied/);
      expect(await partitionsOf(s)).toContain(partOf(s, monthAgo(4)));
    });

    it('refuses a stream that is not archivable, so a bug cannot drop chat messages', async () => {
      const r = await call(worker, 'messages', monthAgo(4));
      expect(r).toMatchObject({ ok: false });
      expect((r as { error: string }).error).toMatch(/not an archivable stream/);
    });

    it('refuses tables that are not range-partitioned parents, and partitions themselves', async () => {
      for (const target of ['organizations', 'an_events_default']) {
        const r = await call(worker, target, monthAgo(4));
        expect(r).toMatchObject({ ok: false });
        expect((r as { error: string }).error).toMatch(/not a range-partitioned table/);
      }
    });

    it('refuses a month that closed less than seven days ago', async () => {
      const r = await call(worker, 'zz_t10', monthAgo(0));
      expect(r).toMatchObject({ ok: false });
      expect((r as { error: string }).error).toMatch(/not been closed for 7 days/);
    });

    it('says false when there is no such partition, and true when it drops one', async () => {
      expect(await call(worker, 'zz_t10', monthAgo(8))).toEqual({ ok: true, dropped: false });
      expect(await call(worker, 'zz_t10', monthAgo(4))).toEqual({ ok: true, dropped: true });
      expect(await partitionsOf('zz_t10')).not.toContain(partOf('zz_t10', monthAgo(4)));
    });
  });
});
