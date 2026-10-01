import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PacingRuntime } from '../../../src/modules/broadcasts/send-safety';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { BroadcastDispatchService } from '../../../src/modules/broadcasts/broadcast-dispatch.service';
import { BroadcastDueService } from '../../../src/modules/broadcasts/broadcast-due.service';
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
 * Sending a broadcast (TW-BCAST-016, with the recipient state machine and outcome of 025, 026, 027): the real app and a
 * real Postgres, with a fake engine adapter standing in for the provider.
 */
let h: Harness;
let api: Api;
let registry: EngineSenderRegistry;
let dispatch: BroadcastDispatchService;

/** What the fake provider does for the next messages. */
let behaviour: (m: OutgoingMessage, n: number) => string | Error = (_m, n) => `wamid.${n}`;
let sent: OutgoingMessage[] = [];

const fakeAdapter = {
  open: () =>
    Promise.resolve({
      send: (m: OutgoingMessage) => {
        sent.push(m);
        const out = behaviour(m, sent.length);
        return out instanceof Error
          ? Promise.reject(out)
          : Promise.resolve({ providerMessageId: out });
      },
    }),
};

beforeAll(async () => {
  h = await startHarness();
  // No real waiting between messages: the gaps are checked in broadcasts-pacing.e2e.spec.ts.
  h.app.get(PacingRuntime).sleep = () => Promise.resolve();
  api = new Api(h);
  registry = h.app.get(EngineSenderRegistry);
  dispatch = h.app.get(BroadcastDispatchService);
  registry.register('baileys', fakeAdapter);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

let counter = 0;
const people = (tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `${tag}${i}`,
    phone: `+91982${String(counter++).padStart(7, '0')}`,
  }));

async function arrange(label: string, contactCount: number, opts: { device?: boolean } = {}) {
  const t = await api.signup(label);
  const tpl = (
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, language, status)
       VALUES ($1, 'promo_oct', 'Hello', 'en_US', 'approved') RETURNING uuid`,
      [t.orgId],
    )
  ).rows[0].uuid as string;
  let senderKey: string | undefined;
  if (opts.device !== false) {
    const dev = (
      await h.owner.query(
        `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
         VALUES ($1, 'Main', '+91', '9811100001', 'connected', true) RETURNING uuid`,
        [t.orgId],
      )
    ).rows[0].uuid as string;
    senderKey = `baileys:${dev}`;
  }
  const contacts = await api.seedContacts(t, people(label, contactCount));
  return { t, tpl, senderKey, contacts };
}

async function create(t: Tenant, body: Record<string, unknown>) {
  const res = await api
    .http()
    .post('/v2/broadcasts')
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const uuid = res.body.broadcasts[0].id as string;
  const row = (await h.owner.query(`SELECT id FROM broadcasts WHERE uuid = $1`, [uuid])).rows[0];
  return { uuid, id: Number(row.id) };
}

const run = (t: Tenant, broadcastId: number) =>
  RequestContextStore.run(
    {
      requestId: `t-${broadcastId}`,
      orgId: t.orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    () => dispatch.run(t.orgId, broadcastId),
  );

const broadcast = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, success_count, delivered_count, fail_count, completed_at, node_schedule_id
         FROM broadcasts WHERE id = $1`,
      [id],
    )
  ).rows[0];

const recipients = async (id: number) =>
  (
    await h.owner.query(
      `SELECT status, error_message, whatsapp_message_id, sent_at FROM broadcast_contacts
        WHERE broadcast_id = $1 ORDER BY id`,
      [id],
    )
  ).rows;

const reset = () => {
  sent = [];
  behaviour = (_m, n) => `wamid.${n}`;
  registry.register('baileys', fakeAdapter);
};

const now = (
  t: Tenant,
  tpl: string,
  senderKey: string | undefined,
  contacts: string[],
  name: string,
) =>
  create(t, {
    name,
    templateId: tpl,
    contactIds: contacts,
    ...(senderKey ? { senderKeys: [senderKey] } : {}),
    scheduleType: 'now',
  });

describe('TW-BCAST-016: handing due broadcasts to the queue', () => {
  it('queues a due broadcast once, with the broadcast uuid as the job id, and never twice', async () => {
    reset();
    const { t, tpl, senderKey, contacts } = await arrange('q1', 2);
    const b = await now(t, tpl, senderKey, contacts, 'Q');
    const add = vi.fn().mockResolvedValue(undefined);
    const due = new BroadcastDueService(h.app.get(DatabaseService), { add } as never);

    expect(await due.enqueueDue()).toBeGreaterThanOrEqual(1);
    expect(add).toHaveBeenCalledWith(
      'dispatch',
      { orgId: t.orgId, broadcastId: b.id },
      { jobId: b.uuid },
    );
    expect((await broadcast(b.id)).node_schedule_id).toBe(`bullmq:${b.uuid}`);

    add.mockClear();
    expect(await due.enqueueDue()).toBe(0);
    expect(add).not.toHaveBeenCalled();
  });

  it('a scheduled broadcast waits for its time', async () => {
    reset();
    const { t, tpl, contacts } = await arrange('q2', 1);
    const b = await create(t, {
      name: 'Later',
      templateId: tpl,
      contactIds: contacts,
      scheduleType: 'later',
      sendDate: '2099-01-01',
      sendTime: '09:00',
    });
    const add = vi.fn().mockResolvedValue(undefined);
    const due = new BroadcastDueService(h.app.get(DatabaseService), { add } as never);
    await due.enqueueDue();
    expect(add.mock.calls.some((c) => c[1].broadcastId === b.id)).toBe(false);
    expect((await broadcast(b.id)).status).toBe('scheduled');

    await h.owner.query(
      `UPDATE broadcasts SET scheduled_at = now() - interval '1 minute' WHERE id = $1`,
      [b.id],
    );
    await due.enqueueDue();
    expect(add.mock.calls.some((c) => c[1].broadcastId === b.id)).toBe(true);
    expect((await broadcast(b.id)).status).toBe('processing');
  });

  it('a queue failure leaves the broadcast due, so the next tick tries again', async () => {
    reset();
    const { t, tpl, senderKey, contacts } = await arrange('q3', 1);
    const b = await now(t, tpl, senderKey, contacts, 'Retry');
    const failing = new BroadcastDueService(h.app.get(DatabaseService), {
      add: vi.fn().mockRejectedValue(new Error('redis down')),
    } as never);
    await expect(failing.enqueueDue()).rejects.toThrow('redis down');
    expect((await broadcast(b.id)).node_schedule_id).toBeNull();
  });
});

describe('TW-BCAST-016: sending', () => {
  it('sends every recipient with the template name, language and number as digits, then completes', async () => {
    reset();
    const { t, tpl, senderKey, contacts } = await arrange('s1', 3);
    const b = await now(t, tpl, senderKey, contacts, 'Go');

    expect(await run(t, b.id)).toBe('finished');
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ templateName: 'promo_oct', language: 'en_US' });
    expect(sent[0]!.to).toMatch(/^91982\d+$/);
    expect(sent[0]!.clientReference).toMatch(new RegExp(`^bcast-${b.id}-\\d+$`));

    const rows = await recipients(b.id);
    expect(rows.map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);
    expect(rows.map((r) => r.whatsapp_message_id)).toEqual(['wamid.1', 'wamid.2', 'wamid.3']);
    expect(rows.every((r) => r.sent_at)).toBe(true);

    const bc = await broadcast(b.id);
    expect(bc).toMatchObject({ status: 'completed', success_count: 3, fail_count: 0 });
    expect(bc.completed_at).not.toBeNull();
    const events = await api.events(t.orgId, 'broadcast.status_changed');
    expect(events.map((e) => e.status)).toContain('completed');
  });

  it('a recipient that fails does not stop the others: completed with errors, the reason is kept', async () => {
    reset();
    const { t, tpl, senderKey, contacts } = await arrange('s2', 3);
    const b = await now(t, tpl, senderKey, contacts, 'Mix');
    behaviour = (_m, n) => (n === 2 ? new Error('(#131026) Message undeliverable') : `wamid.${n}`);

    await run(t, b.id);
    const rows = await recipients(b.id);
    expect(rows.map((r) => r.status)).toEqual(['sent', 'failed', 'sent']);
    expect(rows[1]!.error_message).toBe('(#131026) Message undeliverable');
    expect(await broadcast(b.id)).toMatchObject({
      status: 'completed_with_errors',
      success_count: 2,
      fail_count: 1,
    });
  });

  it('when every recipient fails the broadcast is failed', async () => {
    reset();
    const { t, tpl, senderKey, contacts } = await arrange('s3', 2);
    const b = await now(t, tpl, senderKey, contacts, 'AllBad');
    behaviour = () => new Error('boom');
    await run(t, b.id);
    expect(await broadcast(b.id)).toMatchObject({
      status: 'failed',
      success_count: 0,
      fail_count: 2,
    });
  });

  it('a recipient without a usable number is failed on its own and the provider is never asked for it', async () => {
    reset();
    const { t, tpl, senderKey } = await arrange('s4', 0);
    const contacts = await api.seedContacts(t, [
      { name: 'Has', phone: '+919820000900' },
      { name: 'None', email: 'none@x.test' },
    ]);
    const b = await now(t, tpl, senderKey, contacts, 'NoPhone');

    await run(t, b.id);
    expect(sent).toHaveLength(1);
    expect((await recipients(b.id)).map((r) => [r.status, r.error_message])).toEqual([
      ['sent', null],
      ['failed', 'No usable phone number'],
    ]);
    expect((await broadcast(b.id)).status).toBe('completed_with_errors');
  });

  it('with no connected sender the broadcast is failed, nothing is sent and the recipients stay pending', async () => {
    reset();
    const { t, tpl, contacts } = await arrange('s5', 2, { device: false });
    const b = await now(t, tpl, undefined, contacts, 'NoSender');
    expect(await run(t, b.id)).toBe('failed');
    expect(sent).toHaveLength(0);
    expect((await recipients(b.id)).map((r) => r.status)).toEqual(['pending', 'pending']);
    expect((await broadcast(b.id)).status).toBe('failed');
  });

  it('an engine with no adapter fails the broadcast without sending', async () => {
    reset();
    const { t, tpl, senderKey, contacts } = await arrange('s6', 1);
    const b = await now(t, tpl, senderKey, contacts, 'Twilio');
    await h.owner.query(
      `UPDATE broadcasts SET provider = 'twilio', device_id = NULL WHERE id = $1`,
      [b.id],
    );
    expect(await run(t, b.id)).toBe('failed');
    expect(sent).toHaveLength(0);
    expect((await broadcast(b.id)).status).toBe('failed');
  });

  it('a sender that cannot be opened fails the broadcast', async () => {
    reset();
    const { t, tpl, senderKey, contacts } = await arrange('s7', 1);
    const b = await now(t, tpl, senderKey, contacts, 'NoCreds');
    registry.register('baileys', { open: () => Promise.reject(new Error('no credentials')) });
    expect(await run(t, b.id)).toBe('failed');
    expect((await broadcast(b.id)).status).toBe('failed');
  });

  it('the emergency halt pauses the run and puts the recipient back; nothing is lost', async () => {
    reset();
    const { t, tpl, senderKey, contacts } = await arrange('s8', 3);
    const b = await now(t, tpl, senderKey, contacts, 'Halt');
    behaviour = (_m, n) =>
      n === 2
        ? (new AppError(ERROR_CODES.AUTH_SEND_HALTED, 'halted', 503) as unknown as Error)
        : `wamid.${n}`;

    expect(await run(t, b.id)).toBe('paused');
    expect((await recipients(b.id)).map((r) => r.status)).toEqual(['sent', 'pending', 'pending']);
    expect(await broadcast(b.id)).toMatchObject({ status: 'paused', success_count: 1 });
  });
});

describe('TW-BCAST-016: running twice is harmless', () => {
  it('a finished broadcast is skipped and nobody is messaged again', async () => {
    reset();
    const { t, tpl, senderKey, contacts } = await arrange('r1', 2);
    const b = await now(t, tpl, senderKey, contacts, 'Twice');
    await run(t, b.id);
    expect(sent).toHaveLength(2);
    expect(await run(t, b.id)).toBe('skipped');
    expect(sent).toHaveLength(2);
  });

  it('after a crash a recipient already claimed is not sent again; one claimed long ago is failed as interrupted', async () => {
    reset();
    const { t, tpl, senderKey, contacts } = await arrange('r2', 3);
    const b = await now(t, tpl, senderKey, contacts, 'Crash');
    const ids = (
      await h.owner.query(`SELECT id FROM broadcast_contacts WHERE broadcast_id = $1 ORDER BY id`, [
        b.id,
      ])
    ).rows.map((r) => r.id);
    // First recipient: claimed a moment ago by a worker that then died. Second: claimed an hour ago.
    await h.owner.query(`UPDATE broadcast_contacts SET status = 'processing' WHERE id = $1`, [
      ids[0],
    ]);
    await h.owner.query(
      `ALTER TABLE broadcast_contacts DISABLE TRIGGER trg_broadcast_contacts_touch`,
    );
    await h.owner.query(
      `UPDATE broadcast_contacts SET status = 'processing', updated_at = now() - interval '1 hour' WHERE id = $1`,
      [ids[1]],
    );
    await h.owner.query(
      `ALTER TABLE broadcast_contacts ENABLE TRIGGER trg_broadcast_contacts_touch`,
    );

    await run(t, b.id);
    expect(sent).toHaveLength(1); // only the third, never the claimed ones
    const rows = await recipients(b.id);
    expect(rows[0]!.status).toBe('processing');
    expect(rows[1]).toMatchObject({
      status: 'failed',
      error_message: 'Send was interrupted before it finished',
    });
    expect(rows[2]!.status).toBe('sent');
    // The first is still in flight as far as the data can tell, so the broadcast is not closed yet.
    expect((await broadcast(b.id)).status).toBe('processing');
  });

  it("one organization's run never touches another's broadcast", async () => {
    reset();
    const a = await arrange('x1', 1);
    const other = await arrange('x2', 1);
    const b = await now(other.t, other.tpl, other.senderKey, other.contacts, 'B');
    // Running B's broadcast id under A's tenant finds nothing and sends nothing.
    expect(await run(a.t, b.id)).toBe('skipped');
    expect(sent).toHaveLength(0);
    expect((await broadcast(b.id)).status).toBe('processing');
  });
});
