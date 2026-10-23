import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, schema, type Tx } from '@crm/db';
import { RollupService } from '../../../src/modules/analytics/rollup/rollup.service';

/**
 * A message that is removed (alone, soft, or with its conversation) leaves the feed rollup: the events subtract it, and the rollup equals
 * the live count of `messages` (deleted_at IS NULL) again. Also the repair function for drift that was already there.
 *
 * Rerun: pnpm --filter @crm/api exec vitest run test/integration/analytics/msg-feed-deletes.spec.ts --testTimeout=300000
 */
describe('message feed rollup: removed messages', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let cutover: Date;
  let org: number;
  let channel: number;
  let seq = 1;

  const q = async (text: string, params: unknown[] = []) => (await owner.query(text, params)).rows;
  const scalar = async (text: string, params: unknown[] = []) =>
    Number((await q(text, params))[0].id);
  const after = (ms: number) => new Date(cutover.getTime() + ms);
  const min = (n: number) => n * 60_000;

  const rollup = new RollupService({
    privileged: async <T>(fn: (t: Tx) => Promise<T>): Promise<T> => {
      await owner.query('BEGIN');
      try {
        const r = await fn(drizzle(owner, { schema }) as unknown as Tx);
        await owner.query('COMMIT');
        return r;
      } catch (e) {
        await owner.query('ROLLBACK');
        throw e;
      }
    },
  });
  // upTo is a JS Date (milliseconds); wait so an event recorded in the same millisecond is below it
  const fold = async () => {
    await new Promise((r) => setTimeout(r, 5));
    return rollup.runOnce({ upTo: new Date((await q(`SELECT clock_timestamp() AS t`))[0].t) });
  };

  const newConv = (key: string) =>
    scalar(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,$3,'t') RETURNING id`,
      [org, channel, key],
    );
  const newMsg = (conv: number, at: Date, kind = 'text') =>
    scalar(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, created_at, meta)
       VALUES ($1,$2,$3,'out',$4,'agent','sent',$5,'{}') RETURNING id`,
      [org, conv, (seq += 1), kind, at.toISOString()],
    );
  /** What the rollup says is in the feed once the worker has folded the stream: metric 4 (event-fed), every status. */
  const rolled = async () => {
    await fold();
    return scalar(
      `SELECT COALESCE(sum(n), 0) AS id FROM an_rollup_hour WHERE org_id = $1 AND metric = 4`,
      [org],
    );
  };
  const live = () =>
    scalar(
      `SELECT count(*) AS id FROM messages WHERE org_id = $1 AND created_at >= $2 AND deleted_at IS NULL AND kind NOT IN ('system','reaction')`,
      [org, cutover.toISOString()],
    );
  const eventCount = (conv: number) =>
    scalar(`SELECT count(*) AS id FROM an_events WHERE conversation_id = $1`, [conv]);

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    cutover = new Date((await q(`SELECT an_msg_feed_cutover() AS c`))[0].c);
    org = await scalar(
      `INSERT INTO organizations (slug, name, plan) VALUES ('mfd', 'mfd', 'starter') RETURNING id`,
    );
    await q(
      `INSERT INTO workspace_settings (org_id, timezone) VALUES ($1, 'Asia/Kolkata') ON CONFLICT (org_id) DO UPDATE SET timezone = excluded.timezone`,
      [org],
    );
    channel = await scalar(
      `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'whatsapp', 'wa') RETURNING id`,
      [org],
    );
  }, 300_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  it('removing one message subtracts it', async () => {
    const conv = await newConv('one');
    const a = await newMsg(conv, after(min(5)));
    await newMsg(conv, after(min(6)));
    expect(await rolled()).toBe(await live());
    await q(`DELETE FROM messages WHERE id = $1`, [a]);
    expect(await rolled()).toBe(await live());
  });

  it('removing a conversation subtracts each of its messages once, with the channel', async () => {
    const conv = await newConv('cascade');
    for (let i = 0; i < 3; i++) await newMsg(conv, after(min(10 + i)));
    expect(await rolled()).toBe(await live());
    await q(`DELETE FROM conversations WHERE id = $1`, [conv]);
    const neg = await q(
      `SELECT channel_id FROM an_events WHERE conversation_id = $1 AND qty < 0`,
      [conv],
    );
    expect(neg).toHaveLength(3);
    expect(neg.every((e) => Number(e.channel_id) === channel)).toBe(true);
    expect(await rolled()).toBe(await live());
  });

  it('a soft delete subtracts and undoing it adds back', async () => {
    const conv = await newConv('soft');
    const m = await newMsg(conv, after(min(20)));
    await q(`UPDATE messages SET deleted_at = now() WHERE id = $1`, [m]);
    expect(await rolled()).toBe(await live());
    await q(`UPDATE messages SET deleted_at = NULL WHERE id = $1`, [m]);
    expect(await rolled()).toBe(await live());
  });

  it('removing a soft-deleted message does not subtract twice', async () => {
    const conv = await newConv('soft-then-hard');
    const m = await newMsg(conv, after(min(25)));
    await q(`UPDATE messages SET deleted_at = now() WHERE id = $1`, [m]);
    await q(`DELETE FROM messages WHERE id = $1`, [m]);
    expect(await rolled()).toBe(await live());
  });

  it('writes nothing for a message older than the cut-over, or one that was never counted', async () => {
    const conv = await newConv('ignored');
    const old = await newMsg(conv, new Date(cutover.getTime() - min(30)));
    const sys = await newMsg(conv, after(min(30)), 'system');
    expect(await eventCount(conv)).toBe(0);
    await q(`DELETE FROM messages WHERE id = ANY($1)`, [[old, sys]]);
    expect(await eventCount(conv)).toBe(0);
  });

  it('the repair writes the correction for drift, and a second run writes nothing', async () => {
    const conv = await newConv('drift');
    const m = await newMsg(conv, after(min(40)));
    await newMsg(conv, after(min(41)));
    await q(`ALTER TABLE messages DISABLE TRIGGER trg_messages_feed_delete`);
    try {
      await q(`DELETE FROM messages WHERE id = $1`, [m]);
    } finally {
      await q(`ALTER TABLE messages ENABLE TRIGGER trg_messages_feed_delete`);
    }
    expect(await rolled()).not.toBe(await live());
    expect(
      Number((await q(`SELECT an_msg_feed_reconcile($1) AS id`, [org]))[0].id),
    ).toBeGreaterThan(0);
    expect(await rolled()).toBe(await live());
    expect(Number((await q(`SELECT an_msg_feed_reconcile($1) AS id`, [org]))[0].id)).toBe(0);
  });
});
