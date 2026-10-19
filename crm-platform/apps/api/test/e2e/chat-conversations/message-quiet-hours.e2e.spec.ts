import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QUEUES } from '../../../src/infra/queue/queues';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import { SendWindowService } from '../../../src/modules/compliance-center';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
  type EnqueueOutboundInput,
} from '../../../src/modules/chat-conversations';
import { messageSendJobId } from '../../../src/modules/chat-conversations/message-dispatch.job';
import type { Tenant } from '../contacts-attributes-tags/support';
import {
  asUser,
  conversationOf,
  messagesOf,
  simChannel,
  simInbound,
  startPipeline,
  until,
  type Pipeline,
} from './pipeline-support';

/**
 * Quiet hours at the inbox (BL-177): a MARKETING template an agent sends inside the workspace's quiet hours is accepted and HELD, not
 * refused: the message stays `queued` with the instant it may go, its job is delayed to that instant, and on release the ConsentGate is
 * asked again. A free-form reply (service) is never held. Real Postgres, Redis and BullMQ workers in the same process; a fixed clock.
 */
let p: Pipeline;
let facade: ConversationsFacade;
let window: SendWindowService;
let queue: Queue;

/** 21:30 in India (quiet 21:00 to 09:00): the +91 peers below are in their quiet hours. */
const EVENING = new Date('2026-10-15T16:00:00Z');
const MORNING = new Date('2026-10-16T03:31:00Z');
const OPENS = '2026-10-16T03:30:00.000Z';
let n = 0;

beforeAll(async () => {
  p = await startPipeline();
  facade = p.h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
  window = p.h.app.get(SendWindowService);
  queue = p.h.app.get<Queue>(getQueueToken(QUEUES.MESSAGE_DISPATCH), { strict: false });
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

beforeEach(() => {
  window.now = () => EVENING;
});
afterEach(() => {
  window.now = () => new Date();
});

async function arrange(label: string, o: { template?: 'marketing' | 'utility' } = {}) {
  const t = await p.api.signup(label);
  await p.h.owner.query(
    `INSERT INTO compliance_settings (org_id, quiet_hours_enabled, quiet_start, quiet_end) VALUES ($1, true, '21:00', '09:00')`,
    [t.orgId],
  );
  await p.h.owner.query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, language, status, category, meta_category)
     VALUES ($1, 'promo', 'Big sale', 'en', 'approved', $2, $2)`,
    [t.orgId, o.template ?? 'marketing'],
  );
  const ch = await simChannel(p, t);
  const peer = `91990000${String(1000 + n++)}`;
  await simInbound(p, t, ch, { from: peer, name: 'Customer', text: 'hello' });
  const conv = await conversationOf(p, t, ch, peer);
  await until('inbound stored', async () => (await messagesOf(p, conv.id as number)).length >= 1);
  // The thread belongs to a contact (so the gate and the window find them by id, and a STOP has someone to land on).
  const contact = await p.h.owner.query(
    `INSERT INTO contacts (org_id, name, phone) VALUES ($1, 'Customer', $2) RETURNING id`,
    [t.orgId, `+${peer}`],
  );
  await p.h.owner.query(`UPDATE conversations SET contact_id = $1 WHERE id = $2`, [
    contact.rows[0].id,
    conv.id,
  ]);
  return { t, ch, thread: { uuid: conv.uuid as string, id: conv.id as number }, peer };
}

const send = (t: Tenant, uuid: string, content: EnqueueOutboundInput['content']) =>
  asUser(t.orgId, t.adminUserId, () =>
    facade.enqueueOutbound({ conversationId: uuid, clientMessageId: randomUUID(), content }),
  );
const template = (): EnqueueOutboundInput['content'] => ({
  kind: 'template',
  name: 'promo',
  language: 'en',
  variables: {},
  body: 'Big sale',
});
interface MessageRow {
  id: number | string;
  status: string;
  client_message_id: string;
  failure_code: string | null;
  meta: { hold?: Record<string, unknown> };
}
const row = async (uuid: string) =>
  (await p.h.owner.query(`SELECT * FROM messages WHERE uuid = $1`, [uuid])).rows[0] as MessageRow;
const events = async (id: number | string) =>
  (
    await p.h.owner.query(
      `SELECT event, detail FROM message_events WHERE message_id = $1 ORDER BY id`,
      [id],
    )
  ).rows as Array<{ event: string; detail: Record<string, unknown> }>;

/** The job of a message, once the worker has delayed it. */
const delayedJob = (uuid: string) =>
  until(`job of ${uuid} delayed`, async () => {
    const job = await queue.getJob(messageSendJobId(uuid, 1));
    return job && (await job.getState()) === 'delayed' ? job : undefined;
  });

describe('BL-177: the inbox holds a marketing template for the quiet hours', () => {
  it('keeps the message queued with the reason, delays its job, and sends it at the opening', async () => {
    const { t, thread } = await arrange('mq1');
    const sent = await send(t, thread.uuid, template());
    const job = await delayedJob(sent.message.id);

    const held = await until('hold recorded', async () => {
      const r = await row(sent.message.id);
      return r.meta?.hold ? r : undefined;
    });
    expect(held.status).toBe('queued');
    expect(held.meta.hold).toMatchObject({ reason: 'quiet_hours', until: OPENS });
    expect((await events(held.id)).map((e) => e.event)).toContain('held');
    // The job sleeps until the opening (BullMQ keeps a delayed job's due time, in ms times 4096, as its score in the delayed set).
    const redis = p.h.app.get<Redis>(REDIS_CLIENT, { strict: false });
    const score = Number(await redis.zscore(queue.toKey('delayed'), job.id!));
    expect(Math.abs(Math.floor(score / 4096) - Date.parse(OPENS))).toBeLessThan(2_000);

    // The thread says so.
    const wire = await asUser(t.orgId, t.adminUserId, () =>
      facade.enqueueOutbound({
        conversationId: thread.uuid,
        clientMessageId: held.client_message_id,
        content: template(),
      }),
    );
    expect(wire.replayed).toBe(true);
    expect(wire.message.hold).toMatchObject({ reason: 'quiet_hours', until: OPENS });

    // Time passes: the job is due, the clock is the morning.
    window.now = () => MORNING;
    await job.promote();
    const done = await until('message sent', async () => {
      const r = await row(sent.message.id);
      return ['sent', 'delivered', 'read'].includes(r.status) ? r : undefined;
    });
    expect(done.status).not.toBe('queued');
    const names = (await events(done.id)).map((e) => e.event);
    expect(names).toContain('held');
    expect(names).toContain('sent');
  }, 90_000);

  it('a free-form reply in the same quiet hours is a service message and goes at once', async () => {
    const { t, thread } = await arrange('mq2');
    const reply = await send(t, thread.uuid, { kind: 'text', body: 'Thanks for writing' });
    const done = await until('reply sent', async () => {
      const r = await row(reply.message.id);
      return ['sent', 'delivered', 'read'].includes(r.status) ? r : undefined;
    });
    expect(done.meta.hold).toBeUndefined();
  }, 60_000);

  it('a utility template is never held', async () => {
    const { t, thread } = await arrange('mq3', { template: 'utility' });
    const sent = await send(t, thread.uuid, template());
    const done = await until('utility sent', async () => {
      const r = await row(sent.message.id);
      return ['sent', 'delivered', 'read'].includes(r.status) ? r : undefined;
    });
    expect(done.meta.hold).toBeUndefined();
  }, 60_000);

  it('a contact who unsubscribed while the message waited is not messaged on release', async () => {
    const { t, thread } = await arrange('mq4');
    const sent = await send(t, thread.uuid, template());
    const job = await delayedJob(sent.message.id);

    await p.h.owner.query(`UPDATE contacts SET is_unsubscribed = true WHERE org_id = $1`, [
      t.orgId,
    ]);
    window.now = () => MORNING;
    await job.promote();
    const failed = await until('message failed', async () => {
      const r = await row(sent.message.id);
      return r.status === 'failed' ? r : undefined;
    });
    expect(failed.failure_code).toBe('CONSENT_OPTED_OUT');
  }, 90_000);
});
