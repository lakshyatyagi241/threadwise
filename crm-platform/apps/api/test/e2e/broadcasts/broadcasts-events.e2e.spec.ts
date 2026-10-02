import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { BroadcastProgressService } from '../../../src/modules/broadcasts/broadcast-progress.service';
import { BroadcastReceiptsService } from '../../../src/modules/broadcasts/broadcast-receipts.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Outbound webhook events and bell notifications emitted by a broadcast (TW-BCAST-029), through the outbox, against a real
 * Postgres.
 */
let h: Harness;
let api: Api;
let progress: BroadcastProgressService;
let receipts: BroadcastReceiptsService;
let db: DatabaseService;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  progress = h.app.get(BroadcastProgressService);
  receipts = h.app.get(BroadcastReceiptsService);
  db = h.app.get(DatabaseService);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

interface Out {
  webhook?: Array<{ event: string; data: Record<string, unknown> }>;
  notification?: { severity: string; title: string; actionUrl: string | null };
  previousStatus?: string | null;
}
const events = async (t: Tenant, type: string) =>
  (await api.events(t.orgId, type)) as unknown as Out[];

const subscribe = (t: Tenant, evts: string[]) =>
  h.owner.query(
    `INSERT INTO webhooks (org_id, name, webhook_url, events) VALUES ($1,'hook','https://example.test/h',$2::jsonb)`,
    [t.orgId, JSON.stringify(evts)],
  );

async function broadcast(t: Tenant, status: string) {
  const r = await h.owner.query(
    `INSERT INTO broadcasts (org_id, name, status, total_recipients) VALUES ($1,'Diwali',$2,1) RETURNING id, uuid`,
    [t.orgId, status],
  );
  return { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}

let n = 0;
async function recipient(t: Tenant, broadcastId: number, status: string, wamid: string) {
  const [uuid] = await api.seedContacts(t, [
    { name: `W${n}`, phone: `+9177${String(n++).padStart(8, '0')}` },
  ]);
  const c = (await h.owner.query(`SELECT id, uuid FROM contacts WHERE uuid = $1`, [uuid])).rows[0];
  await h.owner.query(
    `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, whatsapp_message_id) VALUES ($1,$2,$3,$4,$5)`,
    [t.orgId, broadcastId, c.id, status, wamid],
  );
  return c.uuid as string;
}

describe('TW-BCAST-029: broadcast lifecycle events', () => {
  it('a status change carries previous_status and the counts, and a finish rings the bell', async () => {
    const t = await api.signup('w1');
    const b = await broadcast(t, 'processing');
    await h.owner.query(`UPDATE broadcasts SET success_count = 3, fail_count = 1 WHERE id = $1`, [
      b.id,
    ]);
    await db.txAs({ orgId: t.orgId }, (tx) => progress.setStatus(tx, t.orgId, b.id, 'completed'));
    const [e] = await events(t, 'broadcast.status_changed');
    expect(e!.previousStatus).toBe('processing');
    expect(e!.webhook![0]).toMatchObject({
      event: 'broadcast_status_updated',
      data: {
        broadcast_id: b.uuid,
        broadcast_name: 'Diwali',
        status: 'completed',
        previous_status: 'processing',
        success_count: 3,
        fail_count: 1,
        total_recipients: 1,
      },
    });
    expect(e!.notification).toMatchObject({
      severity: 'success',
      actionUrl: `/broadcasts/${b.uuid}`,
    });
  });

  it('a non-terminal change has the webhook but no bell entry', async () => {
    const t = await api.signup('w2');
    const b = await broadcast(t, 'scheduled');
    await db.txAs({ orgId: t.orgId }, (tx) => progress.setStatus(tx, t.orgId, b.id, 'processing'));
    const [e] = await events(t, 'broadcast.status_changed');
    expect(e!.webhook).toHaveLength(1);
    expect(e!.notification).toBeUndefined();
  });

  it('delete rings a warning bell entry with no link', async () => {
    const t = await api.signup('w3');
    const b = await broadcast(t, 'scheduled');
    const res = await api
      .http()
      .delete(`/v2/broadcasts/${b.uuid}`)
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID());
    expect(res.status).toBe(204);
    const [e] = await events(t, 'broadcast.deleted');
    expect(e!.notification).toMatchObject({
      severity: 'warning',
      title: 'Broadcast deleted',
      actionUrl: null,
    });
  });
});

describe('TW-BCAST-029: per-message events', () => {
  it('nothing is written for a receipt while no webhook is listening', async () => {
    const t = await api.signup('w4');
    const b = await broadcast(t, 'completed');
    await recipient(t, b.id, 'sent', `wamid.${t.orgId}.a`);
    await receipts.handle({
      providerMessageId: `wamid.${t.orgId}.a`,
      status: 'delivered',
      occurredAt: new Date(),
    });
    expect(await events(t, 'broadcast.message_status')).toHaveLength(0);
  });

  it('with a subscriber, a delivered receipt writes both events with an exact aggregate', async () => {
    const t = await api.signup('w5');
    await subscribe(t, ['message_delivered']);
    const b = await broadcast(t, 'completed');
    const contact = await recipient(t, b.id, 'sent', `wamid.${t.orgId}.b`);
    await receipts.handle({
      providerMessageId: `wamid.${t.orgId}.b`,
      status: 'delivered',
      occurredAt: new Date('2026-10-02T10:00:00Z'),
    });
    const [e] = await events(t, 'broadcast.message_status');
    expect(e!.webhook!.map((w) => w.event)).toEqual([
      'broadcast_message_status_updated',
      'message_delivered',
    ]);
    expect(e!.webhook![1]!.data).toMatchObject({
      broadcast_id: b.uuid,
      contact_id: contact,
      wamid: `wamid.${t.orgId}.b`,
      status: 'delivered',
      timestamp: Date.parse('2026-10-02T10:00:00Z') / 1000,
      aggregate: { sent: 1, delivered: 1, read: 0, failed: 0, total: 1 },
    });
  });

  it('a repeated receipt writes no second event, and a failed one carries the reason', async () => {
    const t = await api.signup('w6');
    await subscribe(t, ['*']);
    const b = await broadcast(t, 'completed');
    await recipient(t, b.id, 'sent', `wamid.${t.orgId}.c`);
    const r = {
      providerMessageId: `wamid.${t.orgId}.c`,
      status: 'failed' as const,
      occurredAt: new Date(),
      errorCode: '131026',
      errorMessage: 'Undeliverable',
    };
    await receipts.handle(r);
    await receipts.handle(r);
    const out = await events(t, 'broadcast.message_status');
    expect(out).toHaveLength(1);
    expect(out[0]!.webhook![0]!.data).toMatchObject({ error_code: '131026' });
    expect(out[0]!.webhook![1]).toMatchObject({
      event: 'message_failed',
      data: { aggregate: { failed: 1 } },
    });
  });
});
