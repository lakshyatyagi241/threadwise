import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { BroadcastOrphanSweeper } from '../../../src/modules/broadcasts/broadcast-orphan-sweeper.service';
import { BroadcastProgressService } from '../../../src/modules/broadcasts/broadcast-progress.service';
import { BroadcastsRepository } from '../../../src/modules/broadcasts/broadcasts.repository';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * A broadcast whose dispatch job was lost (the worker was restarted mid-job) stays `processing` with its recipients `pending` and no
 * error. The sweeper re-queues a recent one (clears `node_schedule_id`; the due-broadcast queueing re-dispatches it) and fails an old or
 * repeatedly lost one, and leaves alone anything that is still moving or legitimately waiting. The real app and Postgres.
 */
let h: Harness;
let api: Api;
let t: Tenant;
let contactId: number;
let sweeper: BroadcastOrphanSweeper;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('orphan');
  await api.seedContacts(t, [{ name: 'Orphan Test', phone: '+919830000001' }]);
  contactId = (await h.owner.query('SELECT id FROM contacts WHERE org_id = $1 LIMIT 1', [t.orgId]))
    .rows[0].id;
  sweeper = new BroadcastOrphanSweeper(
    h.app.get(DatabaseService),
    h.app.get(BroadcastProgressService),
    h.app.get(OutboxService),
    h.app.get(BroadcastsRepository),
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

interface Seed {
  status?: string;
  jobId?: string | null;
  attempts?: number;
  /** minutes since the broadcast and its recipient last changed */
  idleMin?: number;
  /** minutes since the recipient last changed (defaults to idleMin) */
  recipientIdleMin?: number;
  heldMin?: number;
  recipient?: string;
}

async function seed(name: string, s: Seed = {}): Promise<number> {
  const idle = s.idleMin ?? 120;
  const b = await h.owner.query(
    `INSERT INTO broadcasts (org_id, name, status, node_schedule_id, send_attempts, scheduled_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now() - ($6 || ' minutes')::interval, now() - ($6 || ' minutes')::interval) RETURNING id`,
    [
      t.orgId,
      name,
      s.status ?? 'processing',
      s.jobId === undefined ? 'bullmq:lost' : s.jobId,
      s.attempts ?? 0,
      String(idle),
    ],
  );
  const id = b.rows[0].id as number;
  await h.owner.query(
    `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, updated_at, held_until)
     VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval,
             CASE WHEN $6::int IS NULL THEN NULL ELSE now() + ($6 || ' minutes')::interval END)`,
    [
      t.orgId,
      id,
      contactId,
      s.recipient ?? 'pending',
      String(s.recipientIdleMin ?? idle),
      s.heldMin ?? null,
    ],
  );
  return id;
}

const row = async (id: number) =>
  (
    await h.owner.query(
      'SELECT status, node_schedule_id, send_attempts FROM broadcasts WHERE org_id = $1 AND id = $2',
      [t.orgId, id],
    )
  ).rows[0] as { status: string; node_schedule_id: string | null; send_attempts: number };

const recipient = async (id: number) =>
  (
    await h.owner.query(
      'SELECT status FROM broadcast_contacts WHERE org_id = $1 AND broadcast_id = $2',
      [t.orgId, id],
    )
  ).rows[0].status as string;

describe('BroadcastOrphanSweeper', () => {
  it('re-queues a recent broadcast whose dispatch job was lost, and does it once', async () => {
    const id = await seed('lost 2h ago');
    const first = await sweeper.sweep();
    expect(first.requeued).toBeGreaterThanOrEqual(1);
    expect(await row(id)).toMatchObject({
      status: 'processing',
      node_schedule_id: null,
      send_attempts: 1,
    });
    expect(await recipient(id)).toBe('pending'); // the sender sends it; the sweeper sends nothing
    await sweeper.sweep();
    expect((await row(id)).send_attempts).toBe(1); // no job id: waiting for the due queueing, not an orphan again
  });

  it('fails a broadcast lost more than a day ago, and sends nothing', async () => {
    const id = await seed('lost 3 days ago', { idleMin: 3 * 24 * 60 });
    await sweeper.sweep();
    expect((await row(id)).status).toBe('failed');
    expect(await recipient(id)).toBe('pending');
  });

  it('fails a broadcast that has already been recovered three times', async () => {
    const id = await seed('lost again', { attempts: 3 });
    await sweeper.sweep();
    expect((await row(id)).status).toBe('failed');
  });

  it('leaves alone a broadcast that is still moving', async () => {
    const id = await seed('moving', { idleMin: 120, recipientIdleMin: 5 });
    await sweeper.sweep();
    expect(await row(id)).toMatchObject({
      status: 'processing',
      node_schedule_id: 'bullmq:lost',
      send_attempts: 0,
    });
  });

  it('leaves alone a recipient held for quiet hours, a recent broadcast, and one with nothing left to send', async () => {
    const held = await seed('held', { heldMin: 60 });
    const recent = await seed('recent', { idleMin: 10 });
    const done = await seed('nothing pending', { recipient: 'sent' });
    await sweeper.sweep();
    for (const id of [held, recent, done]) {
      expect(await row(id)).toMatchObject({
        status: 'processing',
        node_schedule_id: 'bullmq:lost',
      });
    }
  });

  it('ignores broadcasts that are not processing', async () => {
    const id = await seed('paused', { status: 'paused' });
    await sweeper.sweep();
    expect((await row(id)).status).toBe('paused');
  });
});
