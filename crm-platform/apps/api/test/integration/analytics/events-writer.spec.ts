import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANALYTICS_EVENT as E } from '@crm/contracts';
import { createDbClient, runMigrations, withPrivileged, withTenant, type DbClient } from '@crm/db';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { AnalyticsEvents } from '../../../src/kernel/analytics/analytics-events.service';

/**
 * The kernel writer against a real Postgres, as the restricted application role. The point of the savepoint test is the whole reason the
 * writer exists in this shape: a failed analytics insert must not take the caller's transaction down with it.
 */
describe('AnalyticsEvents writer', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: DbClient;
  let orgA: number;
  let orgB: number;

  const ctx = (orgId: number): RequestContext => ({
    requestId: 'test',
    orgId,
    actorType: 'user',
    actorId: 1,
    userId: 1,
  });
  const config = (values: Record<string, boolean>) =>
    ({ get: (key: string) => values[key] }) as never;
  const rows = async (org: number) =>
    (await owner.query(`SELECT * FROM an_events WHERE org_id = $1 ORDER BY id`, [org])).rows;

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
    orgA = await org('aw-a');
    orgB = await org('aw-b');
    app = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 2,
    });
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await owner?.end();
    await container?.stop();
  });

  it('stores one event with the request organization, the dimensions and qty 1', async () => {
    const writer = new AnalyticsEvents();
    const ok = await RequestContextStore.run(ctx(orgA), () =>
      withTenant(app.db, { orgId: orgA }, (tx) =>
        writer.record(tx, {
          type: E.MSG_DELIVERED,
          channelKind: 1,
          campaignId: 9,
          durationMs: 1500,
          props: { reason: 'ok' },
        }),
      ),
    );
    expect(ok).toBe(true);
    const stored = await rows(orgA);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      org_id: orgA,
      type: 3,
      channel_kind: 1,
      campaign_id: 9,
      duration_ms: 1500,
      qty: 1,
      props: { reason: 'ok' },
    });
    expect(stored[0].contact_id).toBeNull();
    expect(await rows(orgB)).toHaveLength(0);
  });

  it('stores several events in one call', async () => {
    const writer = new AnalyticsEvents();
    await RequestContextStore.run(ctx(orgB), () =>
      withTenant(app.db, { orgId: orgB }, (tx) =>
        writer.recordMany(tx, [
          { type: E.MSG_QUEUED },
          { type: E.MSG_SENT },
          { type: E.MSG_READ, qty: 3 },
        ]),
      ),
    );
    const stored = await rows(orgB);
    expect(stored.map((r) => r.type)).toEqual([1, 2, 4]);
    expect(stored[2].qty).toBe(3);
  });

  it('swallows a failed insert and leaves the surrounding transaction usable', async () => {
    const writer = new AnalyticsEvents();
    const before = writer.stats();
    const result = await RequestContextStore.run(ctx(orgA), () =>
      withTenant(app.db, { orgId: orgA }, async (tx) => {
        // 40000 overflows the smallint column: the database refuses it inside the savepoint.
        const bad = await writer.record(tx, { type: 40000 as never });
        const alive = await tx.execute(sql`SELECT 1 AS one`);
        const good = await writer.record(tx, { type: E.MSG_FAILED, qty: 5 });
        return { bad, alive: alive.rows.length, good };
      }),
    );
    expect(result).toEqual({ bad: false, alive: 1, good: true });
    expect(writer.stats().failures).toBe(before.failures + 1);
    const stored = await rows(orgA);
    expect(stored.some((r) => r.type === 5 && r.qty === 5)).toBe(true);
    expect(stored.some((r) => r.type === 40000)).toBe(false);
  });

  it('records nothing and reports success when analytics events are switched off', async () => {
    const writer = new AnalyticsEvents(config({ ANALYTICS_EVENTS_ENABLED: false }));
    const count = (await rows(orgA)).length;
    const ok = await RequestContextStore.run(ctx(orgA), () =>
      withTenant(app.db, { orgId: orgA }, (tx) => writer.record(tx, { type: E.MSG_SENT })),
    );
    expect(ok).toBe(true);
    expect(await rows(orgA)).toHaveLength(count);
  });

  it('refuses an event that has no organization, instead of storing org 0', async () => {
    const writer = new AnalyticsEvents();
    const ok = await withPrivileged(app.db, (tx) => writer.record(tx, { type: E.MSG_SENT }));
    expect(ok).toBe(false);
    expect(writer.stats().failures).toBe(1);
    expect(
      (await owner.query(`SELECT count(*)::int AS n FROM an_events WHERE org_id = 0`)).rows[0].n,
    ).toBe(0);
  });

  it('lets a background job name the organization when there is no request', async () => {
    const writer = new AnalyticsEvents();
    const ok = await withPrivileged(app.db, (tx) =>
      writer.record(tx, { type: E.CONTACT_CREATED, orgId: orgB }),
    );
    expect(ok).toBe(true);
    expect((await rows(orgB)).some((r) => r.type === 130)).toBe(true);
  });
});
