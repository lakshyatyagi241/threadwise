import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { METRIC } from '@crm/contracts';
import { createDbClient, runMigrations, withPrivileged, type DbClient } from '@crm/db';
import {
  ROLLUP_LOCK_KEY,
  RollupService,
  type Privileged,
} from '../../../src/modules/analytics/rollup/rollup.service';

/**
 * The rollup pass against a real Postgres, driven the way the worker drives it: the restricted application role with the privileged flag.
 * Events are seeded by the owner connection with explicit `recorded_at` (minutes after `base`) and `occurred_at` (calendar time).
 */
describe('RollupService', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: DbClient;
  let svc: RollupService;
  let base: Date;
  let utcA: number;
  let utcB: number;
  let kolkata: number;
  let newYork: number;

  const at = (minutes: number): Date => new Date(base.getTime() + minutes * 60_000);

  interface Seed {
    org: number;
    type: number;
    rec: number;
    occ: string;
    ck?: number;
    sk?: number;
    camp?: number;
    agent?: number;
    dur?: number;
    qty?: number;
  }
  const seed = (e: Seed) =>
    owner.query(
      `INSERT INTO an_events (org_id, type, recorded_at, occurred_at, channel_kind, source_kind, campaign_id, agent_id, duration_ms, qty)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        e.org,
        e.type,
        at(e.rec).toISOString(),
        e.occ,
        e.ck ?? null,
        e.sk ?? null,
        e.camp ?? null,
        e.agent ?? null,
        e.dur ?? null,
        e.qty ?? 1,
      ],
    );

  async function reset(): Promise<void> {
    await owner.query('TRUNCATE an_events');
    await owner.query('TRUNCATE an_rollup_hour, an_rollup_day');
    await owner.query(`UPDATE an_rollup_state SET recorded_before = $1 WHERE name = 'main'`, [
      at(-1).toISOString(),
    ]);
  }

  const setTz = (org: number, tz: string) =>
    owner.query(
      `INSERT INTO workspace_settings (org_id, timezone) VALUES ($1, $2)
       ON CONFLICT (org_id) DO UPDATE SET timezone = excluded.timezone`,
      [org, tz],
    );

  type Row = { bucket: string; d1: number; d2: number; d3: number; n: number; s1: number };
  const toRows = (rows: Array<Record<string, unknown>>): Row[] =>
    rows.map((r) => ({
      bucket: String(r.bucket),
      d1: Number(r.d1),
      d2: Number(r.d2),
      d3: Number(r.d3),
      n: Number(r.n),
      s1: Number(r.s1),
    }));
  const dayRows = async (org: number, metric: number): Promise<Row[]> =>
    toRows(
      (
        await owner.query(
          `SELECT bucket::text AS bucket, d1, d2, d3, n, s1 FROM an_rollup_day
            WHERE org_id = $1 AND metric = $2 ORDER BY bucket, d1, d2, d3`,
          [org, metric],
        )
      ).rows,
    );
  const hourRows = async (org: number, metric: number): Promise<Row[]> =>
    toRows(
      (
        await owner.query(
          `SELECT to_char(bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS bucket, d1, d2, d3, n, s1
             FROM an_rollup_hour WHERE org_id = $1 AND metric = $2 ORDER BY bucket, d1, d2, d3`,
          [org, metric],
        )
      ).rows,
    );

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    const org = async (slug: string) =>
      Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            slug,
          ])
        ).rows[0].id,
      );
    utcA = await org('ru-a');
    utcB = await org('ru-b');
    kolkata = await org('ru-kolkata');
    newYork = await org('ru-ny');
    await setTz(utcA, 'UTC');
    await setTz(utcB, 'UTC');
    await setTz(kolkata, 'Asia/Kolkata');
    await setTz(newYork, 'America/New_York');
    app = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
    const priv: Privileged = { privileged: (fn) => withPrivileged(app.db, fn) };
    svc = new RollupService(priv);
    base = new Date(Math.floor((Date.now() - 180 * 60_000) / 60_000) * 60_000);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await container?.stop();
  });

  it('aggregates events into hour and day rows per workspace, plus platform rows without campaign data', async () => {
    await reset();
    const occ = '2026-10-01T10:00:00Z';
    for (let i = 0; i < 3; i += 1) await seed({ org: utcA, type: 3, rec: i, occ, ck: 1, sk: 2 });
    await seed({ org: utcA, type: 5, rec: 3, occ, ck: 1, sk: 2 });
    for (let i = 0; i < 2; i += 1)
      await seed({ org: utcB, type: 3, rec: 4 + i, occ, ck: 1, sk: 2 });

    const pass = await svc.runOnce();
    expect(pass).not.toBeNull();
    expect(pass!.slices).toBeGreaterThan(0);

    expect(await dayRows(utcA, METRIC.MSG_COUNT)).toEqual([
      { bucket: '2026-10-01', d1: 3, d2: 1, d3: 2, n: 3, s1: 0 },
      { bucket: '2026-10-01', d1: 5, d2: 1, d3: 2, n: 1, s1: 0 },
    ]);
    expect((await hourRows(utcA, METRIC.MSG_COUNT)).map((r) => r.bucket)).toEqual([
      '2026-10-01T10:00',
      '2026-10-01T10:00',
    ]);
    expect(await dayRows(utcB, METRIC.MSG_COUNT)).toEqual([
      { bucket: '2026-10-01', d1: 3, d2: 1, d3: 2, n: 2, s1: 0 },
    ]);
    // Platform rows (org 0) are the sum across workspaces.
    expect(await dayRows(0, METRIC.MSG_COUNT)).toEqual([
      { bucket: '2026-10-01', d1: 3, d2: 1, d3: 2, n: 5, s1: 0 },
      { bucket: '2026-10-01', d1: 5, d2: 1, d3: 2, n: 1, s1: 0 },
    ]);
    // The campaign breakdown only counts events that carry a campaign, and has no platform rows.
    expect(await dayRows(utcA, METRIC.MSG_BY_CAMPAIGN)).toEqual([]);
    expect(await dayRows(0, METRIC.MSG_BY_CAMPAIGN)).toEqual([]);
  }, 120_000);

  it('does not count anything twice: a second pass adds nothing, new events add exactly themselves', async () => {
    await reset();
    const occ = '2026-10-01T10:00:00Z';
    await seed({ org: utcA, type: 3, rec: 0, occ, ck: 1, sk: 1 });
    await seed({ org: utcA, type: 3, rec: 1, occ, ck: 1, sk: 1 });
    await svc.runOnce();
    const first = await dayRows(utcA, METRIC.MSG_COUNT);
    expect(first[0]!.n).toBe(2);

    const again = await svc.runOnce();
    expect(again!.slices).toBe(0);
    expect(await dayRows(utcA, METRIC.MSG_COUNT)).toEqual(first);

    // New events are stamped by the database clock, as real writers do (never behind the watermark).
    for (let i = 0; i < 2; i += 1) {
      await owner.query(
        `INSERT INTO an_events (org_id, type, occurred_at, channel_kind, source_kind) VALUES ($1, 3, $2, 1, 1)`,
        [utcA, occ],
      );
    }
    await svc.runOnce({ upTo: new Date(Date.now() + 60_000) });
    expect((await dayRows(utcA, METRIC.MSG_COUNT))[0]!.n).toBe(4);
  }, 120_000);

  it('leaves events inside the lag window for the next pass', async () => {
    await reset();
    await owner.query(
      `INSERT INTO an_events (org_id, type, occurred_at, channel_kind, source_kind) VALUES ($1, 3, now(), 1, 1)`,
      [utcA],
    );
    await svc.runOnce();
    expect(await dayRows(utcA, METRIC.MSG_COUNT)).toEqual([]);

    await svc.runOnce({ upTo: new Date(Date.now() + 60_000) });
    expect((await dayRows(utcA, METRIC.MSG_COUNT))[0]!.n).toBe(1);
  }, 120_000);

  it('adds a late event to the bucket of its business time, not to today', async () => {
    await reset();
    await seed({ org: utcA, type: 3, rec: 2, occ: '2026-09-21T09:15:00Z', ck: 1, sk: 1 });
    await svc.runOnce();
    const rows = await dayRows(utcA, METRIC.MSG_COUNT);
    expect(rows.map((r) => r.bucket)).toEqual(['2026-09-21']);
  }, 120_000);

  it('buckets by the workspace timezone: India +5:30 and New York, platform rows in UTC', async () => {
    await reset();
    await seed({ org: kolkata, type: 3, rec: 0, occ: '2026-10-01T18:40:00Z', ck: 1, sk: 1 });
    await seed({ org: newYork, type: 3, rec: 1, occ: '2026-10-01T02:30:00Z', ck: 1, sk: 1 });
    await seed({ org: utcA, type: 3, rec: 2, occ: '2026-10-01T18:40:00Z', ck: 1, sk: 1 });
    await svc.runOnce();

    // 18:40 UTC is 00:10 on the 2nd in Kolkata; the local hour starts at 18:30 UTC.
    expect((await dayRows(kolkata, METRIC.MSG_COUNT)).map((r) => r.bucket)).toEqual(['2026-10-02']);
    expect((await hourRows(kolkata, METRIC.MSG_COUNT)).map((r) => r.bucket)).toEqual([
      '2026-10-01T18:30',
    ]);
    // 02:30 UTC is 22:30 on the 30th in New York (EDT); the local hour starts at 02:00 UTC.
    expect((await dayRows(newYork, METRIC.MSG_COUNT)).map((r) => r.bucket)).toEqual(['2026-09-30']);
    expect((await hourRows(newYork, METRIC.MSG_COUNT)).map((r) => r.bucket)).toEqual([
      '2026-10-01T02:00',
    ]);
    // A plain UTC workspace is unchanged.
    expect((await dayRows(utcA, METRIC.MSG_COUNT)).map((r) => r.bucket)).toEqual(['2026-10-01']);
    // Platform rows ignore workspace timezones: all three events are on UTC day 1 or 2 by their own instant.
    const platform = await dayRows(0, METRIC.MSG_COUNT);
    expect(platform.map((r) => [r.bucket, r.n])).toEqual([['2026-10-01', 3]]);
  }, 120_000);

  it('counts both 01:30 events of a DST fall-back night on the same local day', async () => {
    await reset();
    await seed({ org: newYork, type: 3, rec: 0, occ: '2026-11-01T05:30:00Z', ck: 1, sk: 1 });
    await seed({ org: newYork, type: 3, rec: 1, occ: '2026-11-01T06:30:00Z', ck: 1, sk: 1 });
    await svc.runOnce();
    const days = await dayRows(newYork, METRIC.MSG_COUNT);
    expect(days.map((r) => [r.bucket, r.n])).toEqual([['2026-11-01', 2]]);
    const hours = await hourRows(newYork, METRIC.MSG_COUNT);
    expect(hours.reduce((sum, r) => sum + r.n, 0)).toBe(2);
  }, 120_000);

  it('turns a latency metric into one row per bucket with d3 as the bucket index', async () => {
    await reset();
    const occ = '2026-10-01T10:00:00Z';
    for (const [i, dur] of [500, 3000, 40000].entries()) {
      await seed({ org: utcA, type: 42, rec: i, occ, agent: 11, dur });
    }
    await svc.runOnce();
    const rows = await dayRows(utcA, METRIC.CONV_FIRST_REPLY_HIST);
    expect(rows.map((r) => [r.d1, r.d3, r.n, r.s1])).toEqual([
      [11, 0, 1, 500],
      [11, 1, 1, 3000],
      [11, 4, 1, 40000],
    ]);
  }, 120_000);

  it('does nothing while another worker holds the lock, and does not double count when two run together', async () => {
    await reset();
    const occ = '2026-10-01T10:00:00Z';
    for (let i = 0; i < 6; i += 1) await seed({ org: utcA, type: 3, rec: i, occ, ck: 1, sk: 1 });

    await owner.query('BEGIN');
    await owner.query(`SELECT pg_advisory_xact_lock($1)`, [ROLLUP_LOCK_KEY]);
    try {
      expect(await svc.runOnce()).toBeNull();
      expect(await dayRows(utcA, METRIC.MSG_COUNT)).toEqual([]);
    } finally {
      await owner.query('ROLLBACK');
    }

    await Promise.all([svc.runOnce(), svc.runOnce()]);
    expect((await dayRows(utcA, METRIC.MSG_COUNT))[0]!.n).toBe(6);
  }, 120_000);

  it('splits a long catch-up into slices and gets the same totals as one pass', async () => {
    await reset();
    const occ = '2026-10-01T10:00:00Z';
    for (let i = 0; i <= 35; i += 1) await seed({ org: utcA, type: 3, rec: i, occ, ck: 1, sk: 1 });
    const pass = await svc.runOnce({ upTo: at(40) });
    expect(pass!.slices).toBe(4);
    expect((await dayRows(utcA, METRIC.MSG_COUNT))[0]!.n).toBe(36);
  }, 120_000);

  describe('nightly reconcile and trim', () => {
    const DAY = '2026-10-01';
    const seedDay = async () => {
      await reset();
      const occ = `${DAY}T10:00:00Z`;
      for (let i = 0; i < 3; i += 1) await seed({ org: utcA, type: 3, rec: i, occ, ck: 1, sk: 2 });
      await seed({ org: kolkata, type: 5, rec: 3, occ, ck: 1, sk: 2 });
      await svc.runOnce();
    };

    it('repairs drifted, missing and stray rows of one day and reports how many it fixed', async () => {
      await seedDay();
      const good = {
        utc: await dayRows(utcA, METRIC.MSG_COUNT),
        platform: await dayRows(0, METRIC.MSG_COUNT),
        kolkata: await dayRows(kolkata, METRIC.MSG_COUNT),
      };
      await owner.query(`UPDATE an_rollup_day SET n = n + 5 WHERE org_id = $1 AND metric = $2`, [
        utcA,
        METRIC.MSG_COUNT,
      ]);
      await owner.query(`DELETE FROM an_rollup_day WHERE org_id = $1 AND metric = $2`, [
        kolkata,
        METRIC.MSG_COUNT,
      ]);
      await owner.query(
        `INSERT INTO an_rollup_day (org_id, metric, bucket, d1, n) VALUES ($1, $2, $3, 99, 7)`,
        [utcA, METRIC.MSG_COUNT, DAY],
      );

      const fixed = await svc.reconcile(DAY);
      expect(fixed.fixedRows).toBe(3);
      expect(await dayRows(utcA, METRIC.MSG_COUNT)).toEqual(good.utc);
      expect(await dayRows(kolkata, METRIC.MSG_COUNT)).toEqual(good.kolkata);
      expect(await dayRows(0, METRIC.MSG_COUNT)).toEqual(good.platform);
      expect((await svc.reconcile(DAY)).fixedRows).toBe(0);
    }, 120_000);

    it('leaves other days alone', async () => {
      await seedDay();
      await owner.query(
        `INSERT INTO an_rollup_day (org_id, metric, bucket, d1, n) VALUES ($1, $2, '2026-09-15', 1, 4)`,
        [utcA, METRIC.MSG_COUNT],
      );
      await svc.reconcile(DAY);
      const other = (await dayRows(utcA, METRIC.MSG_COUNT)).filter(
        (r) => r.bucket === '2026-09-15',
      );
      expect(other).toEqual([{ bucket: '2026-09-15', d1: 1, d2: 0, d3: 0, n: 4, s1: 0 }]);
    }, 120_000);

    it('waits for the rollup lock instead of racing a pass', async () => {
      await seedDay();
      await owner.query('BEGIN');
      await owner.query(`SELECT pg_advisory_xact_lock($1)`, [ROLLUP_LOCK_KEY]);
      let finished = false;
      const run = svc.reconcile(DAY).then((r) => {
        finished = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 700));
      expect(finished).toBe(false);
      await owner.query('ROLLBACK');
      await run;
      expect(finished).toBe(true);
    }, 120_000);

    it('trims hour rows past the retention and never day rows', async () => {
      await reset();
      const old = new Date(Date.now() - 130 * 86_400_000).toISOString();
      const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
      await owner.query(
        `INSERT INTO an_rollup_hour (org_id, metric, bucket, n) VALUES ($1, 1, $2, 1), ($1, 1, $3, 1)`,
        [utcA, old, recent],
      );
      await owner.query(
        `INSERT INTO an_rollup_day (org_id, metric, bucket, n) VALUES ($1, 1, $2, 1)`,
        [utcA, old.slice(0, 10)],
      );
      expect(await svc.trimHourRows(120)).toBe(1);
      expect((await hourRows(utcA, 1)).length).toBe(1);
      expect((await dayRows(utcA, 1)).length).toBe(1);
    }, 120_000);
  });

  it('matches an independent calculation for random events and random watermark splits', async () => {
    const orgs = [
      { id: () => utcA, tz: 'UTC' },
      { id: () => kolkata, tz: 'Asia/Kolkata' },
      { id: () => newYork, tz: 'America/New_York' },
    ];
    const localDate = (iso: string, tz: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(iso));

    for (let round = 0; round < 8; round += 1) {
      let s = 0x9e3779b9 + round * 7919;
      const rnd = () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      await reset();
      const expected = new Map<string, number>();
      const bump = (k: string) => expected.set(k, (expected.get(k) ?? 0) + 1);
      for (let i = 0; i < 150; i += 1) {
        const o = orgs[Math.floor(rnd() * orgs.length)]!;
        const type = 1 + Math.floor(rnd() * 6);
        const ck = 1 + Math.floor(rnd() * 3);
        const sk = 1 + Math.floor(rnd() * 2);
        const occ = new Date(Date.now() - rnd() * 3 * 86_400_000).toISOString();
        await seed({ org: o.id(), type, rec: rnd() * 170, occ, ck, sk });
        bump(`${o.id()}|${localDate(occ, o.tz)}|${type}|${ck}|${sk}`);
        bump(`0|${localDate(occ, 'UTC')}|${type}|${ck}|${sk}`);
      }
      await svc.runOnce({ upTo: at(20 + rnd() * 130) });
      await svc.runOnce();

      const got = new Map<string, number>();
      for (const org of [0, utcA, kolkata, newYork]) {
        for (const r of await dayRows(org, METRIC.MSG_COUNT)) {
          got.set(`${org}|${r.bucket}|${r.d1}|${r.d2}|${r.d3}`, r.n);
        }
      }
      expect(Object.fromEntries(got), `round ${round}`).toEqual(Object.fromEntries(expected));

      // The hour rows add up to the day rows for every workspace and dimension.
      for (const org of [utcA, kolkata, newYork]) {
        const hourTotal = (await hourRows(org, METRIC.MSG_COUNT)).reduce((a, r) => a + r.n, 0);
        const dayTotal = (await dayRows(org, METRIC.MSG_COUNT)).reduce((a, r) => a + r.n, 0);
        expect(hourTotal, `round ${round} org ${org}`).toBe(dayTotal);
      }
    }
  }, 600_000);
});
