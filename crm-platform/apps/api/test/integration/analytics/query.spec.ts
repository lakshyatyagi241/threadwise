import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { METRIC } from '@crm/contracts';
import { createDbClient, runMigrations, withPrivileged, withTenant, type DbClient } from '@crm/db';
import { AnalyticsQueryService } from '../../../src/modules/analytics/query/analytics-query.service';
import {
  RollupService,
  type Privileged,
} from '../../../src/modules/analytics/rollup/rollup.service';

/**
 * AnalyticsQueryService against a real Postgres: rollup rows plus the live tail must equal a direct count of the events, wherever the
 * watermark happens to be. The oracle is plain JavaScript (Intl for the workspace-local date), independent of the SQL under test.
 */
describe('AnalyticsQueryService', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: DbClient;
  let rollup: RollupService;
  let base: Date;
  let utcA: number;
  let utcB: number;
  let kolkata: number;

  const at = (minutes: number): Date => new Date(base.getTime() + minutes * 60_000);
  const memoryRedis = () => {
    const store = new Map<string, string>();
    return {
      store,
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
    };
  };
  const asTenant = <T>(orgId: number, fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(app.db, { orgId }, fn);

  async function reset(): Promise<void> {
    await owner.query('TRUNCATE an_events');
    await owner.query('TRUNCATE an_rollup_hour, an_rollup_day');
    await owner.query(`UPDATE an_rollup_state SET recorded_before = $1 WHERE name = 'main'`, [
      at(-1).toISOString(),
    ]);
  }

  interface Seed {
    org: number;
    type: number;
    rec: number;
    occ: string;
    ck?: number;
    sk?: number;
    camp?: number;
  }
  const seed = (e: Seed) =>
    owner.query(
      `INSERT INTO an_events (org_id, type, recorded_at, occurred_at, channel_kind, source_kind, campaign_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [e.org, e.type, at(e.rec).toISOString(), e.occ, e.ck ?? null, e.sk ?? null, e.camp ?? null],
    );

  const localDate = (iso: string, tz: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

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
    const org = async (slug: string, tz: string) => {
      const id = Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            slug,
          ])
        ).rows[0].id,
      );
      await owner.query(
        `INSERT INTO workspace_settings (org_id, timezone) VALUES ($1, $2)
         ON CONFLICT (org_id) DO UPDATE SET timezone = excluded.timezone`,
        [id, tz],
      );
      return id;
    };
    utcA = await org('q-a', 'UTC');
    utcB = await org('q-b', 'UTC');
    kolkata = await org('q-kolkata', 'Asia/Kolkata');
    app = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
    const priv: Privileged = { privileged: (fn) => withPrivileged(app.db, fn) };
    rollup = new RollupService(priv);
    base = new Date(Math.floor((Date.now() - 180 * 60_000) / 60_000) * 60_000);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await container?.stop();
  });

  const WIDE = {
    from: new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10),
    to: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  };

  it('returns rollup plus live tail equal to a direct count, wherever the watermark is', async () => {
    const q = new AnalyticsQueryService();
    for (let round = 0; round < 10; round += 1) {
      const rnd = rng(1234 + round * 31);
      await reset();
      const orgs = [
        { id: utcA, tz: 'UTC' },
        { id: kolkata, tz: 'Asia/Kolkata' },
      ];
      const expected = new Map<string, number>();
      for (let i = 0; i < 80; i += 1) {
        const o = orgs[Math.floor(rnd() * orgs.length)]!;
        const type = 1 + Math.floor(rnd() * 6);
        const ck = 1 + Math.floor(rnd() * 3);
        const sk = 1 + Math.floor(rnd() * 2);
        const occ = new Date(Date.now() - rnd() * 3 * 86_400_000).toISOString();
        await seed({ org: o.id, type, rec: rnd() * 170, occ, ck, sk });
        const key = `${o.id}|${localDate(occ, o.tz)}|${type}|${ck}|${sk}`;
        expected.set(key, (expected.get(key) ?? 0) + 1);
      }
      // Anywhere from "nothing rolled yet" to "everything rolled".
      if (round > 0) await rollup.runOnce({ upTo: at(round === 9 ? 175 : rnd() * 170) });

      for (const o of orgs) {
        const rows = await asTenant(o.id, (tx) =>
          q.series(tx, {
            orgId: o.id,
            metric: METRIC.MSG_COUNT,
            grain: 'day',
            ...WIDE,
            groupBy: ['bucket', 'd1', 'd2', 'd3'],
          }),
        );
        const got = Object.fromEntries(
          rows.map((r) => [`${o.id}|${r.bucket}|${r.d1}|${r.d2}|${r.d3}`, r.n]),
        );
        const want = Object.fromEntries([...expected].filter(([k]) => k.startsWith(`${o.id}|`)));
        expect(got, `round ${round} org ${o.id}`).toEqual(want);
      }
    }
  }, 600_000);

  it('groups by chosen dimensions and filters on the others', async () => {
    await reset();
    const occ = '2026-10-01T10:00:00Z';
    await seed({ org: utcA, type: 3, rec: 0, occ, ck: 1, sk: 1, camp: 7 });
    await seed({ org: utcA, type: 3, rec: 1, occ, ck: 2, sk: 1, camp: 7 });
    await seed({ org: utcA, type: 5, rec: 2, occ, ck: 1, sk: 1, camp: 8 });
    await rollup.runOnce();
    const q = new AnalyticsQueryService();
    const range = { from: '2026-10-01', to: '2026-10-02' };

    const byType = await asTenant(utcA, (tx) =>
      q.series(tx, {
        orgId: utcA,
        metric: METRIC.MSG_COUNT,
        grain: 'day',
        ...range,
        groupBy: ['d1'],
      }),
    );
    expect(byType.map((r) => [r.d1, r.n])).toEqual([
      [3, 2],
      [5, 1],
    ]);

    const channelOne = await asTenant(utcA, (tx) =>
      q.series(tx, {
        orgId: utcA,
        metric: METRIC.MSG_COUNT,
        grain: 'day',
        ...range,
        filter: { d2: 1 },
        groupBy: ['d1'],
      }),
    );
    expect(channelOne.map((r) => [r.d1, r.n])).toEqual([
      [3, 1],
      [5, 1],
    ]);

    const campaign = await asTenant(utcA, (tx) =>
      q.series(tx, {
        orgId: utcA,
        metric: METRIC.MSG_BY_CAMPAIGN,
        grain: 'day',
        ...range,
        filter: { d1: 7 },
        groupBy: ['d2'],
      }),
    );
    expect(campaign.map((r) => [r.d2, r.n])).toEqual([[3, 2]]);
  }, 120_000);

  it('serves hour buckets as ISO instants and the latency histogram by bucket index', async () => {
    await reset();
    await seed({ org: utcA, type: 3, rec: 0, occ: '2026-10-01T10:20:00Z', ck: 1, sk: 1 });
    await owner.query(
      `INSERT INTO an_events (org_id, type, occurred_at, duration_ms, agent_id) VALUES ($1, 42, '2026-10-01T10:30:00Z', 3000, 5)`,
      [utcA],
    );
    const q = new AnalyticsQueryService();
    const hours = await asTenant(utcA, (tx) =>
      q.series(tx, {
        orgId: utcA,
        metric: METRIC.MSG_COUNT,
        grain: 'hour',
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-02T00:00:00Z',
      }),
    );
    expect(hours).toEqual([{ bucket: '2026-10-01T10:00:00Z', n: 1, s1: 0, s2: 0 }]);
    const hist = await asTenant(utcA, (tx) =>
      q.series(tx, {
        orgId: utcA,
        metric: METRIC.CONV_FIRST_REPLY_HIST,
        grain: 'day',
        from: '2026-10-01',
        to: '2026-10-02',
        groupBy: ['d1', 'd3'],
      }),
    );
    expect(hist.map((r) => [r.d1, r.d3, r.n, r.s1])).toEqual([[5, 1, 1, 3000]]);
  }, 120_000);

  it('refuses a window longer than the metric allows, or an empty one', async () => {
    const q = new AnalyticsQueryService();
    const call = (from: string, to: string) =>
      asTenant(utcA, (tx) =>
        q.series(tx, { orgId: utcA, metric: METRIC.MSG_COUNT, grain: 'day', from, to }),
      );
    await expect(call('2025-01-01', '2026-10-01')).rejects.toThrow(/window/i);
    await expect(call('2026-10-02', '2026-10-01')).rejects.toThrow(/window/i);
  }, 60_000);

  it('never returns another workspace, and keeps platform rows for privileged callers only', async () => {
    await reset();
    const occ = '2026-10-01T10:00:00Z';
    await seed({ org: utcA, type: 3, rec: 0, occ, ck: 1, sk: 1 });
    await seed({ org: utcB, type: 3, rec: 1, occ, ck: 1, sk: 1 });
    await seed({ org: utcB, type: 3, rec: 2, occ, ck: 1, sk: 1 });
    await rollup.runOnce();
    const q = new AnalyticsQueryService();
    const range = { from: '2026-10-01', to: '2026-10-02' };

    const asA = await asTenant(utcA, (tx) =>
      q.series(tx, { orgId: utcA, metric: METRIC.MSG_COUNT, grain: 'day', ...range }),
    );
    expect(asA.map((r) => r.n)).toEqual([1]);
    // Asking for B while acting as A is refused outright, before any data is read.
    await expect(
      asTenant(utcA, (tx) =>
        q.series(tx, { orgId: utcB, metric: METRIC.MSG_COUNT, grain: 'day', ...range }),
      ),
    ).rejects.toThrow(/not the one this transaction belongs to/);
    await expect(
      asTenant(utcA, (tx) =>
        q.series(tx, { orgId: 0, metric: METRIC.MSG_COUNT, grain: 'day', ...range }),
      ),
    ).rejects.toThrow(/privileged/i);
    const platform = await withPrivileged(app.db, (tx) =>
      q.series(tx, { orgId: 0, metric: METRIC.MSG_COUNT, grain: 'day', ...range }),
    );
    expect(platform.map((r) => r.n)).toEqual([3]);
  }, 120_000);

  it('caches by workspace and query, and shares one execution between concurrent callers', async () => {
    await reset();
    const occ = '2026-10-01T10:00:00Z';
    await seed({ org: utcA, type: 3, rec: 0, occ, ck: 1, sk: 1 });
    await seed({ org: utcB, type: 3, rec: 1, occ, ck: 1, sk: 1 });
    await seed({ org: utcB, type: 3, rec: 2, occ, ck: 1, sk: 1 });
    await rollup.runOnce();
    const redis = memoryRedis();
    const q = new AnalyticsQueryService(redis as never);
    const spy = vi.spyOn(q, 'series');
    const range = { from: '2026-10-01', to: '2026-10-02' };
    const run = (org: number) =>
      asTenant(org, (tx) =>
        q.seriesCached(
          tx,
          { orgId: org, metric: METRIC.MSG_COUNT, grain: 'day', ...range },
          { ttlSeconds: 30 },
        ),
      );

    const [a1, a2, a3] = await Promise.all([run(utcA), run(utcA), run(utcA)]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a1).toEqual(a2);
    expect(a1).toEqual(a3);

    const a4 = await run(utcA);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a4.map((r) => r.n)).toEqual([1]);

    const b = await run(utcB);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(b.map((r) => r.n)).toEqual([2]);
    const keys = [...redis.store.keys()];
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toEqual(keys[1]);
    expect(keys.every((k) => k.startsWith('an:v1:'))).toBe(true);

    // A ttl of 0 bypasses the cache entirely.
    const before = redis.set.mock.calls.length;
    await asTenant(utcA, (tx) =>
      q.seriesCached(
        tx,
        { orgId: utcA, metric: METRIC.MSG_COUNT, grain: 'day', ...range },
        { ttlSeconds: 0 },
      ),
    );
    expect(redis.set.mock.calls.length).toBe(before);
  }, 120_000);

  it('does not let a cache hit hand one workspace the numbers of another', async () => {
    await reset();
    await seed({ org: utcB, type: 3, rec: 0, occ: '2026-10-01T10:00:00Z', ck: 1, sk: 1 });
    await rollup.runOnce();
    const redis = memoryRedis();
    const q = new AnalyticsQueryService(redis as never);
    const query = {
      orgId: utcB,
      metric: METRIC.MSG_COUNT,
      grain: 'day' as const,
      from: '2026-10-01',
      to: '2026-10-02',
    };
    // B's own request fills the cache.
    const own = await asTenant(utcB, (tx) => q.seriesCached(tx, query, { ttlSeconds: 60 }));
    expect(own.map((r) => r.n)).toEqual([1]);
    expect(redis.store.size).toBe(1);
    // A asks for B's key: refused even though the answer is sitting in the cache.
    await expect(
      asTenant(utcA, (tx) => q.seriesCached(tx, query, { ttlSeconds: 60 })),
    ).rejects.toThrow(/not the one this transaction belongs to/);
    // A privileged caller (a worker, an operator console) may read any workspace.
    const priv = await withPrivileged(app.db, (tx) =>
      q.seriesCached(tx, query, { ttlSeconds: 60 }),
    );
    expect(priv.map((r) => r.n)).toEqual([1]);
  }, 120_000);

  it('rejects a group-by or filter that is not one of the known columns, before building any SQL', async () => {
    const q = new AnalyticsQueryService();
    const base = {
      orgId: utcA,
      metric: METRIC.MSG_COUNT,
      grain: 'day' as const,
      from: '2026-10-01',
      to: '2026-10-02',
    };
    await expect(
      asTenant(utcA, (tx) =>
        q.series(tx, { ...base, groupBy: ['d1; DROP TABLE an_events'] as never }),
      ),
    ).rejects.toThrow(/group by/i);
    await expect(
      asTenant(utcA, (tx) => q.series(tx, { ...base, groupBy: ['d1', 'd1'] as never })),
    ).rejects.toThrow(/group by/i);
    await expect(
      asTenant(utcA, (tx) => q.series(tx, { ...base, filter: { d1: 1.5 } })),
    ).rejects.toThrow(/filter/i);
    await expect(
      asTenant(utcA, (tx) => q.series(tx, { ...base, grain: 'week' as never })),
    ).rejects.toThrow(/grain/i);
    expect((await owner.query(`SELECT to_regclass('public.an_events') AS t`)).rows[0].t).toBe(
      'an_events',
    );
  }, 60_000);

  it('still answers when the cache is down', async () => {
    await reset();
    await seed({ org: utcA, type: 3, rec: 0, occ: '2026-10-01T10:00:00Z', ck: 1, sk: 1 });
    await rollup.runOnce();
    const broken = {
      get: vi.fn().mockRejectedValue(new Error('redis down')),
      set: vi.fn().mockRejectedValue(new Error('redis down')),
    };
    const q = new AnalyticsQueryService(broken as never);
    const rows = await asTenant(utcA, (tx) =>
      q.seriesCached(
        tx,
        {
          orgId: utcA,
          metric: METRIC.MSG_COUNT,
          grain: 'day',
          from: '2026-10-01',
          to: '2026-10-02',
        },
        { ttlSeconds: 30 },
      ),
    );
    expect(rows.map((r) => r.n)).toEqual([1]);
  }, 60_000);
});
