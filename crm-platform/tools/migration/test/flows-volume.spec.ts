import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { runClient } from '../load/run';
import { reconcile } from '../reconcile';
import { asOwner, cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';
import { bid, bulkFlows, chatbot, node, version } from './flows-fixtures';

const dbs: TestDb[] = [];
const dumps: Dumps[] = [];
afterAll(async () => {
  for (const d of dbs) await d.drop();
  for (const d of dumps) d.cleanup();
});
const count = async (db: TestDb, t: string): Promise<number> =>
  asOwner(db, async (d) =>
    Number(
      ((await d.execute(sql.raw(`SELECT count(*)::int AS n FROM ${t}`))).rows[0] as { n: number })
        .n,
    ),
  );

describe('volume and limits', () => {
  it('loads 300 bots of 20 steps (6,000 step documents), re-runs in a moment, and reconcile agrees', async () => {
    const d = await customDumps({ acme: { contact_list: [], ...bulkFlows(300, 20) } });
    dumps.push(d);
    const db = await cloneDb('fl-vol');
    dbs.push(db);
    const o = runOpts(d, db, 'acme', {
      org: { name: 'acme', slug: 'acme', ownerEmail: 'o@example.test' },
      batchSize: 100,
    });
    const t0 = Date.now();
    await runClient(o);
    const load = Date.now() - t0;
    expect(await count(db, 'flows')).toBe(300);
    expect(await count(db, 'keyword_replies')).toBe(300);
    const t1 = Date.now();
    await runClient(o);
    const again = Date.now() - t1;
    const t2 = Date.now();
    const r = await reconcile({
      source: d.source,
      dumpsDir: d.dir,
      client: 'acme',
      targetUrl: db.workerUrl,
      sampleSize: 1000,
    });
    const verify = Date.now() - t2;
    expect(r.alarms).toEqual([]);
    expect(r.ok).toBe(true);
    console.log(`flows volume: load ${load} ms, second run ${again} ms, reconcile ${verify} ms`);
    expect(await count(db, 'flows')).toBe(300);
  });

  it('a graph over the editor limit is quarantined GRAPH_TOO_LARGE with its documents excluded, and nothing else is lost', async () => {
    const B = bid(7);
    const big = Array.from({ length: 501 }, (_, i) =>
      node({ bot: B, version: 'v', qid: 'Q', node: 1 + i, sub: 'text', order: i }),
    );
    const d = await customDumps({
      acme: {
        contact_list: [],
        chatbots: [chatbot(7), chatbot(8)],
        bot_flow_version: [
          version(B, 'v', 'published', '2026-03-01T00:00:00Z', '2026-03-02T00:00:00Z'),
        ],
        bot_flow_version_data: [
          ...big,
          node({ bot: bid(8), version: 'w', qid: 'Q', node: 9000, sub: 'text', order: 0 }),
        ],
      },
    });
    dumps.push(d);
    const db = await cloneDb('fl-big');
    dbs.push(db);
    await runClient(
      runOpts(d, db, 'acme', { org: { name: 'acme', slug: 'acme', ownerEmail: 'o@example.test' } }),
    );
    expect(await count(db, 'flows')).toBe(1);
    const q = await asOwner(
      db,
      async (x) =>
        (
          await x.execute(
            sql.raw(`SELECT reason_code FROM migration.quarantine WHERE collection = 'flow_bots'`),
          )
        ).rows as Array<{ reason_code: string }>,
    );
    expect(q.map((r) => r.reason_code)).toContain('GRAPH_TOO_LARGE');
    const r = await reconcile({
      source: d.source,
      dumpsDir: d.dir,
      client: 'acme',
      targetUrl: db.workerUrl,
      sampleSize: 1000,
    });
    expect(r.alarms).toEqual([]);
  });
});
