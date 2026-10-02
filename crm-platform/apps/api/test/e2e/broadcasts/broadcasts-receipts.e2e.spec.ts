import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BroadcastReceiptsService,
  type DeliveryReceipt,
} from '../../../src/modules/broadcasts/broadcast-receipts.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Delivery receipts (TW-BCAST-024, 027): a report about a sent message moves the recipient and the broadcast's counters, from
 * whichever provider it came, against a real Postgres.
 */
let h: Harness;
let api: Api;
let receipts: BroadcastReceiptsService;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  receipts = h.app.get(BroadcastReceiptsService);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

let counter = 0;
/** A broadcast whose recipients have all been sent, each with its own provider message id. */
async function sentBroadcast(t: Tenant, n: number, status = 'completed') {
  const b = (
    await h.owner.query(
      `INSERT INTO broadcasts (org_id, name, status, total_recipients, success_count) VALUES ($1,'R',$2,$3,$3) RETURNING id`,
      [t.orgId, status, n],
    )
  ).rows[0];
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [uuid] = await api.seedContacts(t, [
      { name: `R${counter}`, phone: `+91988${String(counter++).padStart(7, '0')}` },
    ]);
    const contact = (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [uuid])).rows[0]
      .id;
    const wamid = `wamid.${t.orgId}.${counter}.${i}`;
    ids.push(wamid);
    await h.owner.query(
      `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, whatsapp_message_id, sent_at) VALUES ($1,$2,$3,'sent',$4, now())`,
      [t.orgId, b.id, contact, wamid],
    );
  }
  return { id: Number(b.id), wamids: ids };
}

const rec = (
  wamid: string,
  status: DeliveryReceipt['status'],
  extra: Partial<DeliveryReceipt> = {},
): DeliveryReceipt => ({
  providerMessageId: wamid,
  status,
  occurredAt: new Date('2026-10-02T10:00:00Z'),
  ...extra,
});

const state = async (id: number, wamid: string) =>
  (
    await h.owner.query(
      `SELECT status, error_message, delivered_at, read_at FROM broadcast_contacts WHERE broadcast_id = $1 AND whatsapp_message_id = $2`,
      [id, wamid],
    )
  ).rows[0];
const counts = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, success_count, delivered_count, read_count, fail_count FROM broadcasts WHERE id = $1`,
      [id],
    )
  ).rows[0];

describe('TW-BCAST-024 and 027: a receipt moves the recipient and the counters', () => {
  it('delivered then read: each timestamp is set once, from the report, and the counters follow', async () => {
    const t = await api.signup('v1');
    const b = await sentBroadcast(t, 1);
    expect(
      await receipts.handle(
        rec(b.wamids[0]!, 'delivered', { occurredAt: new Date('2026-10-02T10:00:00Z') }),
      ),
    ).toBe(true);
    let r = await state(b.id, b.wamids[0]!);
    expect(r.status).toBe('delivered');
    expect(new Date(r.delivered_at).toISOString()).toBe('2026-10-02T10:00:00.000Z');
    expect(await counts(b.id)).toMatchObject({
      success_count: 1,
      delivered_count: 1,
      read_count: 0,
    });

    await receipts.handle(
      rec(b.wamids[0]!, 'read', { occurredAt: new Date('2026-10-02T10:05:00Z') }),
    );
    r = await state(b.id, b.wamids[0]!);
    expect(r.status).toBe('read');
    expect(new Date(r.read_at).toISOString()).toBe('2026-10-02T10:05:00.000Z');
    expect(await counts(b.id)).toMatchObject({
      success_count: 1,
      delivered_count: 1,
      read_count: 1,
    });
  });

  it('the same report twice changes nothing: the counters are not applied twice', async () => {
    const t = await api.signup('v2');
    const b = await sentBroadcast(t, 1);
    await receipts.handle(rec(b.wamids[0]!, 'delivered'));
    await receipts.handle(rec(b.wamids[0]!, 'delivered'));
    await receipts.handle(
      rec(b.wamids[0]!, 'delivered', { occurredAt: new Date('2026-10-02T11:00:00Z') }),
    );
    expect(await counts(b.id)).toMatchObject({ delivered_count: 1 });
    expect(new Date((await state(b.id, b.wamids[0]!)).delivered_at).toISOString()).toBe(
      '2026-10-02T10:00:00.000Z',
    );
  });

  it('a late delivered after read stays read; a late sent after delivered stays delivered', async () => {
    const t = await api.signup('v3');
    const b = await sentBroadcast(t, 2);
    await receipts.handle(rec(b.wamids[0]!, 'read'));
    await receipts.handle(rec(b.wamids[0]!, 'delivered'));
    expect((await state(b.id, b.wamids[0]!)).status).toBe('read');
    await receipts.handle(rec(b.wamids[1]!, 'delivered'));
    await receipts.handle(rec(b.wamids[1]!, 'sent'));
    expect((await state(b.id, b.wamids[1]!)).status).toBe('delivered');
    expect(await counts(b.id)).toMatchObject({
      success_count: 2,
      delivered_count: 2,
      read_count: 1,
    });
  });

  it('a read that arrives before its delivered counts both', async () => {
    const t = await api.signup('v4');
    const b = await sentBroadcast(t, 1);
    await receipts.handle(rec(b.wamids[0]!, 'read'));
    expect(await counts(b.id)).toMatchObject({
      success_count: 1,
      delivered_count: 1,
      read_count: 1,
    });
  });

  it('a failure takes the recipient out of success and keeps the reason; it stays failed for good', async () => {
    const t = await api.signup('v5');
    const b = await sentBroadcast(t, 2);
    await receipts.handle(rec(b.wamids[0]!, 'delivered'));
    await receipts.handle(
      rec(b.wamids[0]!, 'failed', { errorMessage: '(#131026) Message undeliverable' }),
    );
    expect(await state(b.id, b.wamids[0]!)).toMatchObject({
      status: 'failed',
      error_message: '(#131026) Message undeliverable',
    });
    expect(await counts(b.id)).toMatchObject({
      success_count: 1,
      delivered_count: 0,
      fail_count: 1,
    });
    await receipts.handle(rec(b.wamids[0]!, 'delivered'));
    await receipts.handle(rec(b.wamids[0]!, 'read'));
    expect((await state(b.id, b.wamids[0]!)).status).toBe('failed');
    expect(await counts(b.id)).toMatchObject({ fail_count: 1, read_count: 0 });
  });

  it('a failure with only a code is kept as error_code:<code>, cut to 512 characters', async () => {
    const t = await api.signup('v6');
    const b = await sentBroadcast(t, 2);
    await receipts.handle(rec(b.wamids[0]!, 'failed', { errorCode: '131047' }));
    expect((await state(b.id, b.wamids[0]!)).error_message).toBe('error_code:131047');
    await receipts.handle(rec(b.wamids[1]!, 'failed', { errorMessage: 'x'.repeat(600) }));
    expect((await state(b.id, b.wamids[1]!)).error_message).toHaveLength(512);
  });

  it('{1 sent, 2 delivered, 1 read, 1 failed}: success 4, delivered 3, read 1, fail 1 (TW-BCAST-027 acceptance)', async () => {
    const t = await api.signup('v7');
    const b = await sentBroadcast(t, 5);
    const w = b.wamids;
    await receipts.handleMany([
      rec(w[1]!, 'delivered'),
      rec(w[2]!, 'delivered'),
      rec(w[3]!, 'read'),
      rec(w[4]!, 'failed', { errorMessage: 'x' }),
    ]);
    expect(await counts(b.id)).toMatchObject({
      success_count: 4,
      delivered_count: 3,
      read_count: 1,
      fail_count: 1,
    });
  });
});

describe('what a late failure does to a finished broadcast', () => {
  it('completed becomes completed with errors when one recipient turns out to have failed', async () => {
    const t = await api.signup('o1');
    const b = await sentBroadcast(t, 2);
    await receipts.handle(rec(b.wamids[0]!, 'failed', { errorMessage: 'x' }));
    expect((await counts(b.id)).status).toBe('completed_with_errors');
  });

  it('and failed when every recipient did', async () => {
    const t = await api.signup('o2');
    const b = await sentBroadcast(t, 2);
    await receipts.handleMany(b.wamids.map((w) => rec(w, 'failed', { errorMessage: 'x' })));
    expect((await counts(b.id)).status).toBe('failed');
  });

  it('a broadcast still running keeps its status: only the sender ends it', async () => {
    const t = await api.signup('o3');
    const b = await sentBroadcast(t, 2, 'processing');
    await receipts.handle(rec(b.wamids[0]!, 'failed', { errorMessage: 'x' }));
    expect((await counts(b.id)).status).toBe('processing');
  });
});

describe('whose message is it', () => {
  it('a message that is not a broadcast one is not touched and is reported as not ours', async () => {
    expect(await receipts.handle(rec('wamid.unknown.1', 'delivered'))).toBe(false);
    expect(await receipts.handle(rec('', 'delivered'))).toBe(false);
  });

  it('a receipt only ever changes the organization that sent the message', async () => {
    const a = await api.signup('w1');
    const other = await api.signup('w1b');
    const ba = await sentBroadcast(a, 1);
    const bo = await sentBroadcast(other, 1);
    await receipts.handle(rec(ba.wamids[0]!, 'delivered'));
    expect((await state(ba.id, ba.wamids[0]!)).status).toBe('delivered');
    expect((await state(bo.id, bo.wamids[0]!)).status).toBe('sent');
    expect(await counts(bo.id)).toMatchObject({ delivered_count: 0 });
  });

  it('a clicked event is not a delivery report: it is for the link redirect and is not ours', async () => {
    const t = await api.signup('w2');
    const b = await sentBroadcast(t, 1);
    expect(
      await receipts.handle({ ...rec(b.wamids[0]!, 'delivered'), status: 'clicked' as never }),
    ).toBe(true);
    expect((await state(b.id, b.wamids[0]!)).status).toBe('sent');
  });
});
