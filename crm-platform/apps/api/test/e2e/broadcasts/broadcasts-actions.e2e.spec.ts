import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PacingRuntime } from '../../../src/modules/broadcasts/send-safety';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { BroadcastDispatchService } from '../../../src/modules/broadcasts/broadcast-dispatch.service';
import { BroadcastProgressService } from '../../../src/modules/broadcasts/broadcast-progress.service';
import { BroadcastRetrySweeper } from '../../../src/modules/broadcasts/broadcast-retry-sweeper.service';
import { BroadcastsRepository } from '../../../src/modules/broadcasts/broadcasts.repository';
import {
  EngineSenderRegistry,
  type OutgoingMessage,
} from '../../../src/modules/broadcasts/engine-senders';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Deleting, retrying and exporting a broadcast, and the automatic retry sweep (TW-BCAST-037, 038, 039, 040): the real app and
 * a real Postgres.
 */
let h: Harness;
let api: Api;
let sweeper: BroadcastRetrySweeper;
let dispatch: BroadcastDispatchService;
let registry: EngineSenderRegistry;
let sent: OutgoingMessage[] = [];

beforeAll(async () => {
  h = await startHarness();
  // No real waiting between messages: the gaps are checked in broadcasts-pacing.e2e.spec.ts.
  h.app.get(PacingRuntime).sleep = () => Promise.resolve();
  api = new Api(h);
  sweeper = new BroadcastRetrySweeper(
    h.app.get(DatabaseService),
    h.app.get(BroadcastsRepository),
    h.app.get(BroadcastProgressService),
    h.app.get(OutboxService),
  );
  dispatch = h.app.get(BroadcastDispatchService);
  registry = h.app.get(EngineSenderRegistry);
  registry.register('baileys', {
    open: () =>
      Promise.resolve({
        send: (m: OutgoingMessage) => {
          sent.push(m);
          return Promise.resolve({ providerMessageId: `wamid.${sent.length}` });
        },
      }),
  });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const req = (t: Tenant, method: 'get' | 'post' | 'delete', path: string) => {
  const r = api.http()[method](path).set(bearer(t.admin));
  return method === 'post' ? r.set('idempotency-key', randomUUID()) : r;
};

let counter = 0;
async function broadcast(
  t: Tenant,
  o: {
    status?: string;
    createdAt?: string;
    attempts?: number;
    nextAttemptAt?: string | null;
    timezone?: string;
    nodeScheduleId?: string | null;
  } = {},
) {
  const res = await h.owner.query(
    `INSERT INTO broadcasts (org_id, name, status, timezone, send_attempts, next_attempt_at, node_schedule_id, created_at)
     VALUES ($1,'B',$2,$3,$4,$5, $6, coalesce($7::timestamptz, now())) RETURNING id, uuid`,
    [
      t.orgId,
      o.status ?? 'completed_with_errors',
      o.timezone ?? 'UTC',
      o.attempts ?? 0,
      o.nextAttemptAt ?? null,
      o.nodeScheduleId ?? null,
      o.createdAt ?? null,
    ],
  );
  return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string };
}

async function recipient(
  t: Tenant,
  broadcastId: number,
  o: {
    status: string;
    name?: string;
    error?: string | null;
    sentAt?: string;
    deliveredAt?: string;
    readAt?: string;
  },
) {
  const [uuid] = await api.seedContacts(t, [
    { name: o.name ?? `Person ${counter}`, phone: `+91985${String(counter++).padStart(7, '0')}` },
  ]);
  const contact = Number(
    (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [uuid])).rows[0].id,
  );
  await h.owner.query(
    `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, error_message, sent_at, delivered_at, read_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      t.orgId,
      broadcastId,
      contact,
      o.status,
      o.error ?? null,
      o.sentAt ?? null,
      o.deliveredAt ?? null,
      o.readAt ?? null,
    ],
  );
  return { contact, uuid };
}

const statuses = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, error_message, whatsapp_message_id FROM broadcast_contacts WHERE broadcast_id = $1 ORDER BY id`,
      [id],
    )
  ).rows;
const row = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, send_attempts, next_attempt_at, node_schedule_id FROM broadcasts WHERE id = $1`,
      [id],
    )
  ).rows[0];

describe('TW-BCAST-040: delete', () => {
  it('a scheduled broadcast goes with its recipients, with an audit row and an event', async () => {
    const t = await api.signup('x1');
    const b = await broadcast(t, { status: 'scheduled' });
    await recipient(t, b.id, { status: 'pending' });
    const res = await req(t, 'delete', `/v2/broadcasts/${b.uuid}`);
    expect(res.status, JSON.stringify(res.body)).toBe(204);
    expect(
      (await h.owner.query(`SELECT 1 FROM broadcasts WHERE id = $1`, [b.id])).rows,
    ).toHaveLength(0);
    expect(
      (await h.owner.query(`SELECT 1 FROM broadcast_contacts WHERE broadcast_id = $1`, [b.id]))
        .rows,
    ).toHaveLength(0);
    expect(await api.auditCount(t.orgId, 'broadcasts', 'delete')).toBe(1);
    expect((await api.events(t.orgId, 'broadcast.deleted'))[0]).toMatchObject({
      uuid: b.uuid,
      status: 'scheduled',
    });
  });

  it('a failed one can be deleted too; a completed, completed-with-errors, paused or running one cannot', async () => {
    const t = await api.signup('x2');
    expect(
      (await req(t, 'delete', `/v2/broadcasts/${(await broadcast(t, { status: 'failed' })).uuid}`))
        .status,
    ).toBe(204);
    for (const status of ['completed', 'completed_with_errors', 'paused', 'processing']) {
      const b = await broadcast(t, { status });
      const res = await req(t, 'delete', `/v2/broadcasts/${b.uuid}`);
      expect(res.status, status).toBe(422);
      expect(res.body.code).toBe('BCAST_NOT_DELETABLE');
      expect(res.body.detail).toBe('Only scheduled or failed broadcasts can be deleted.');
      expect(
        (await h.owner.query(`SELECT 1 FROM broadcasts WHERE id = $1`, [b.id])).rows,
      ).toHaveLength(1);
    }
  });

  it("another organization's broadcast is a 404 and is left alone; a member without the key gets 403", async () => {
    const t = await api.signup('x3');
    const other = await api.signup('x3b');
    const theirs = await broadcast(other, { status: 'failed' });
    expect((await req(t, 'delete', `/v2/broadcasts/${theirs.uuid}`)).status).toBe(404);
    expect(
      (await h.owner.query(`SELECT 1 FROM broadcasts WHERE id = $1`, [theirs.id])).rows,
    ).toHaveLength(1);
    const mine = await broadcast(t, { status: 'failed' });
    const m = await api.member(t, 'viewer', [['bcast.broadcasts.read']]);
    expect(
      (await api.http().delete(`/v2/broadcasts/${mine.uuid}`).set(bearer(m.token))).status,
    ).toBe(403);
  });
});

describe('TW-BCAST-038: retry the failed recipients', () => {
  it('3 failed and 1 delivered: the 3 go back to pending with the error cleared, the delivered one is untouched, and only those 3 are sent', async () => {
    sent = [];
    const t = await api.signup('y1');
    const dev = (
      await h.owner.query(
        `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active) VALUES ($1,'D','+91','9811100003','connected',true) RETURNING id`,
        [t.orgId],
      )
    ).rows[0].id;
    const tpl = (
      await h.owner.query(
        `INSERT INTO wa_templates (org_id, template_name, template_body, status) VALUES ($1,'p','x','approved') RETURNING id`,
        [t.orgId],
      )
    ).rows[0].id;
    const b = await broadcast(t, { status: 'completed_with_errors', nodeScheduleId: 'bullmq:old' });
    await h.owner.query(
      `UPDATE broadcasts SET provider='baileys', device_id=$2, template_id=$3, total_recipients=4 WHERE id=$1`,
      [b.id, dev, tpl],
    );
    await recipient(t, b.id, {
      status: 'delivered',
      sentAt: '2026-10-02T03:00:00Z',
      deliveredAt: '2026-10-02T03:01:00Z',
    });
    for (let i = 0; i < 3; i++) await recipient(t, b.id, { status: 'failed', error: 'timeout' });

    const res = await req(t, 'post', `/v2/broadcasts/${b.uuid}/retry-failed`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ retried: 3, status: 'processing' });
    expect((await statuses(b.id)).map((r) => [r.status, r.error_message])).toEqual([
      ['delivered', null],
      ['pending', null],
      ['pending', null],
      ['pending', null],
    ]);
    expect(await row(b.id)).toMatchObject({
      status: 'processing',
      send_attempts: 0,
      node_schedule_id: null,
    });
    expect((await api.events(t.orgId, 'broadcast.retry_requested'))[0]).toMatchObject({
      retried: 3,
      auto: false,
    });

    await RequestContextStore.run(
      { requestId: 'r', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
      () => dispatch.run(t.orgId, b.id),
    );
    expect(sent).toHaveLength(3);
    expect((await statuses(b.id)).map((r) => r.status)).toEqual([
      'delivered',
      'sent',
      'sent',
      'sent',
    ]);
  });

  it('with nothing failed it is refused', async () => {
    const t = await api.signup('y2');
    const b = await broadcast(t, { status: 'completed' });
    await recipient(t, b.id, { status: 'sent' });
    const res = await req(t, 'post', `/v2/broadcasts/${b.uuid}/retry-failed`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BCAST_NO_FAILED_RECIPIENTS');
    expect(res.body.detail).toBe('No failed recipients to retry.');
  });

  it('while the broadcast is running or waiting it is refused (Reference allowed a second concurrent loop)', async () => {
    const t = await api.signup('y3');
    for (const status of ['processing', 'scheduled']) {
      const b = await broadcast(t, { status });
      await recipient(t, b.id, { status: 'failed', error: 'x' });
      const res = await req(t, 'post', `/v2/broadcasts/${b.uuid}/retry-failed`);
      expect(res.status, status).toBe(409);
      expect(res.body.code).toBe('BCAST_NOT_RETRYABLE');
      expect((await statuses(b.id))[0]!.status).toBe('failed');
    }
  });

  it("another organization's broadcast is a 404; a member without the retry key gets 403", async () => {
    const t = await api.signup('y4');
    const other = await api.signup('y4b');
    const theirs = await broadcast(other);
    await recipient(other, theirs.id, { status: 'failed', error: 'x' });
    expect((await req(t, 'post', `/v2/broadcasts/${theirs.uuid}/retry-failed`)).status).toBe(404);
    expect((await statuses(theirs.id))[0]!.status).toBe('failed');
    const mine = await broadcast(t);
    const m = await api.member(t, 'viewer', [['bcast.broadcasts.read']]);
    expect(
      (
        await api
          .http()
          .post(`/v2/broadcasts/${mine.uuid}/retry-failed`)
          .set(bearer(m.token))
          .set('idempotency-key', randomUUID())
      ).status,
    ).toBe(403);
  });
});

/** The harness database is shared by every case here, so earlier broadcasts can fill a batch: sweep until nothing is left. */
const sweepAll = async () => {
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const n = await sweeper.sweep();
    total += n;
    if (n === 0) break;
  }
  return total;
};

describe('TW-BCAST-039: the automatic retry sweep', () => {
  const failed = async (t: Tenant, b: { id: number }, n = 2, error = 'timeout') => {
    for (let i = 0; i < n; i++) await recipient(t, b.id, { status: 'failed', error });
  };

  it("re-queues the failed recipients of yesterday's broadcast: attempt 1, the next in about 60 s", async () => {
    const t = await api.signup('z1');
    const b = await broadcast(t, { createdAt: new Date(Date.now() - 86_400_000).toISOString() });
    await failed(t, b);
    expect(await sweepAll()).toBeGreaterThanOrEqual(1);
    const r = await row(b.id);
    expect(r).toMatchObject({ status: 'processing', send_attempts: 1, node_schedule_id: null });
    const wait = (new Date(r.next_attempt_at).getTime() - Date.now()) / 1000;
    expect(wait).toBeGreaterThan(40);
    expect(wait).toBeLessThanOrEqual(61);
    expect((await statuses(b.id)).map((s) => s.status)).toEqual(['pending', 'pending']);
    expect((await api.events(t.orgId, 'broadcast.retry_requested'))[0]).toMatchObject({
      retried: 2,
      attempt: 1,
      auto: true,
    });
  });

  it('doubles the wait for each further attempt, and stops when the attempts are used up', async () => {
    const t = await api.signup('z2');
    const second = await broadcast(t, { attempts: 1 });
    await failed(t, second);
    const spent = await broadcast(t, { attempts: 3 });
    await failed(t, spent);
    await sweepAll();
    const wait = (new Date((await row(second.id)).next_attempt_at).getTime() - Date.now()) / 1000;
    expect(wait).toBeGreaterThan(100);
    expect(wait).toBeLessThanOrEqual(121);
    expect(await row(spent.id)).toMatchObject({
      status: 'completed_with_errors',
      send_attempts: 3,
    });
  });

  it('ignores a broadcast older than 7 days, one still running, one whose next attempt is not due, and permanent failures', async () => {
    const t = await api.signup('z3');
    const old = await broadcast(t, {
      createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    });
    const running = await broadcast(t, { status: 'processing' });
    const waiting = await broadcast(t, {
      nextAttemptAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const permanent = await broadcast(t);
    for (const b of [old, running, waiting]) await failed(t, b);
    await failed(t, permanent, 1, 'No usable phone number');
    await failed(t, permanent, 1, '(#131026) Message undeliverable');
    await sweepAll();
    for (const b of [old, running, waiting, permanent]) {
      expect(
        (await statuses(b.id)).every((s) => s.status === 'failed'),
        String(b.id),
      ).toBe(true);
      expect((await row(b.id)).send_attempts).toBe(0);
    }
  });

  it('retries the retryable failures and leaves the permanent ones for review', async () => {
    const t = await api.signup('z4');
    const b = await broadcast(t);
    await failed(t, b, 1, 'timeout');
    await failed(t, b, 1, 'No usable phone number');
    await sweepAll();
    expect((await statuses(b.id)).map((s) => s.status)).toEqual(['pending', 'failed']);
  });

  it('honours an organization override of the attempts', async () => {
    const t = await api.signup('z5');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"broadcast_retry_attempts": 1, "broadcast_retry_backoff_sec": 0}'::jsonb WHERE org_id = $1`,
      [t.orgId],
    );
    const b = await broadcast(t);
    await failed(t, b);
    await sweepAll();
    expect(await row(b.id)).toMatchObject({ send_attempts: 1 });
    // The wait is 0 with a base of 0, and the one attempt allowed is now used.
    await h.owner.query(`UPDATE broadcasts SET status = 'completed_with_errors' WHERE id = $1`, [
      b.id,
    ]);
    await h.owner.query(
      `UPDATE broadcast_contacts SET status = 'failed', error_message = 'timeout' WHERE broadcast_id = $1`,
      [b.id],
    );
    await sweepAll();
    expect((await statuses(b.id)).every((s) => s.status === 'failed')).toBe(true);
  });
});

describe('TW-BCAST-037: CSV export', () => {
  const csv = async (t: Tenant, uuid: string) => {
    const res = await req(t, 'get', `/v2/broadcasts/${uuid}/export`)
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (c: Buffer) => (data += c.toString('utf8')));
        r.on('end', () => cb(null, data));
      });
    return res;
  };

  it('a header and one line per recipient, with the filename pattern and the times in the broadcast zone', async () => {
    const t = await api.signup('e1');
    const b = await broadcast(t, { timezone: 'Asia/Kolkata' });
    await recipient(t, b.id, { status: 'sent', name: 'Ana', sentAt: '2026-10-02T03:31:00Z' });
    await recipient(t, b.id, { status: 'failed', name: 'Ravi', error: 'timeout' });
    const res = await csv(t, b.uuid);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(
      new RegExp(`^attachment; filename="broadcast-${b.uuid}-recipients-\\d{8}-\\d{6}\\.csv"$`),
    );
    const lines = (res.body as string).trim().split('\n');
    expect(lines[0]).toBe(
      'Recipient,Phone,Status,Clicked,Queued,Sent,Delivered,Read,Failed,Last event,Error',
    );
    expect(lines).toHaveLength(3);
    const ana = lines.find((l) => l.startsWith('Ana'))!.split(',');
    expect(ana[2]).toBe('Sent');
    expect(ana[5]).toBe('2026-10-02 09:01'); // 03:31 UTC in Kolkata
    expect(ana[9]).toBe('Sent');
    expect(lines.find((l) => l.startsWith('Ravi'))).toMatch(/,Failed,No,.*,Failed,timeout$/);
    expect(await api.auditCount(t.orgId, 'broadcasts', 'export')).toBe(1);
  });

  it('a name that looks like a formula is guarded; a recipient who clicked is Yes and Button tap', async () => {
    const t = await api.signup('e2');
    const b = await broadcast(t);
    const r = await recipient(t, b.id, {
      status: 'read',
      name: '=HYPERLINK("x")',
      sentAt: '2026-10-02T03:31:00Z',
      readAt: '2026-10-02T03:40:00Z',
    });
    await h.owner.query(
      `INSERT INTO wa_link_clicks (org_id, token, original_url, broadcast_id, contact_id, clicks) VALUES ($1,'t','https://x.test',$2,$3,2)`,
      [t.orgId, b.id, r.contact],
    );
    const line = ((await csv(t, b.uuid)).body as string).trim().split('\n')[1]!;
    expect(line.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(line).toMatch(/,Read,Yes,/);
    expect(line).toMatch(/,Button tap,$/);
  });

  it('streams a broadcast of thousands of recipients across pages without losing or repeating one', async () => {
    const t = await api.signup('e3');
    const b = await broadcast(t);
    await h.owner.query(
      `INSERT INTO contacts (org_id, name, phone) SELECT $1, 'Bulk ' || g, '+9197' || lpad(g::text, 8, '0') FROM generate_series(1, 2500) g`,
      [t.orgId],
    );
    await h.owner.query(
      `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status) SELECT $1, $2, id, 'sent' FROM contacts WHERE org_id = $1`,
      [t.orgId, b.id],
    );
    const lines = ((await csv(t, b.uuid)).body as string).trim().split('\n');
    expect(lines).toHaveLength(2501);
    expect(new Set(lines.slice(1)).size).toBe(2500);
  });

  it("another organization's broadcast is a 404; a member without the export key gets 403", async () => {
    const t = await api.signup('e4');
    const other = await api.signup('e4b');
    const theirs = await broadcast(other);
    expect((await req(t, 'get', `/v2/broadcasts/${theirs.uuid}/export`)).status).toBe(404);
    const mine = await broadcast(t);
    const m = await api.member(t, 'viewer', [['bcast.broadcasts.read']]);
    expect(
      (await api.http().get(`/v2/broadcasts/${mine.uuid}/export`).set(bearer(m.token))).status,
    ).toBe(403);
  });
});
