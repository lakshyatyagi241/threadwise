import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { QUEUES } from '../../../src/infra/queue/queues';
import { EmergencyHaltService } from '../../../src/modules/auth/security/emergency-halt.service';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
  type EnqueueOutboundInput,
} from '../../../src/modules/chat-conversations';
import { ChannelAdapterRegistry } from '../../../src/modules/chat-conversations/channel-adapter.registry';
import { MessageDispatchProcessor } from '../../../src/modules/chat-conversations/message-dispatch.processor';
import { MessageDispatchService } from '../../../src/modules/chat-conversations/message-dispatch.service';
import { OutboundService } from '../../../src/modules/chat-conversations/outbound.service';
import { QueuedMessageRecoveryService } from '../../../src/modules/chat-conversations/queued-message-recovery.service';
import type { Tenant } from '../contacts-attributes-tags/support';
import {
  asUser,
  conversationOf,
  eventsOf,
  joinConversation,
  listen,
  messagesOf,
  scalar,
  simChannel,
  simInbound,
  sleep,
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from './pipeline-support';

/**
 * The outbound pipeline end to end (plan-inbox-chat.md 3.4): an agent's reply is guarded and stored `queued`, a worker sends it through
 * the dispatcher, the simulated provider reports ticks, and the message ends where the provider says. Real Postgres, Redis, BullMQ
 * workers in the same process, sockets. The simulator's faults (/fail, /flaky, /ooo) stand in for the provider's behaviour.
 */
let p: Pipeline;
let facade: ConversationsFacade;
let operatorId: number;

beforeAll(async () => {
  p = await startPipeline();
  facade = p.h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
  operatorId = Number(
    (await p.h.owner.query(`SELECT id FROM platform_operators ORDER BY id LIMIT 1`)).rows[0].id,
  );
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

afterEach(() => vi.restoreAllMocks());

const HOUR = 3_600_000;

interface Thread {
  uuid: string;
  id: number;
}

/** A thread with one customer message in it (so the window is open and somebody is waiting). */
async function thread(
  t: Tenant,
  ch: SimChannel,
  peer: string,
  extra: Record<string, unknown> = {},
): Promise<Thread> {
  await simInbound(p, t, ch, { from: peer, name: 'Customer', text: 'hello', ...extra });
  const conv = await conversationOf(p, t, ch, peer);
  await until('inbound stored', async () => (await messagesOf(p, conv.id as number)).length >= 1);
  return { uuid: conv.uuid as string, id: conv.id as number };
}

const send = (
  t: Tenant,
  conv: Thread,
  content: EnqueueOutboundInput['content'],
  more: Partial<EnqueueOutboundInput> = {},
) =>
  asUser(t.orgId, t.adminUserId, () =>
    facade.enqueueOutbound({
      conversationId: conv.uuid,
      clientMessageId: randomUUID(),
      content,
      ...more,
    }),
  );
const text = (body: string): EnqueueOutboundInput['content'] => ({ kind: 'text', body });

const row = async (uuid: string) =>
  (await p.h.owner.query(`SELECT * FROM messages WHERE uuid = $1`, [uuid])).rows[0] as Record<
    string,
    unknown
  >;
const waitStatus = async (uuid: string, status: string, ms = 15_000) => {
  try {
    return await until(
      `message ${status}`,
      async () => {
        const r = await row(uuid);
        return r?.status === status ? r : undefined;
      },
      ms,
    );
  } catch (err) {
    const r = await row(uuid);
    throw new Error(
      `${(err as Error).message} (the message is ${String(r?.status)}, failure ${String(r?.failure_code)})`,
    );
  }
};
const events = async (messageId: number | string) =>
  (
    await p.h.owner.query(
      `SELECT event, detail FROM message_events WHERE message_id = $1 ORDER BY id`,
      [messageId],
    )
  ).rows as Array<{ event: string; detail: Record<string, unknown> }>;
const conv = async (id: number) =>
  (await p.h.owner.query(`SELECT * FROM conversations WHERE id = $1`, [id])).rows[0] as Record<
    string,
    unknown
  >;
const simAdapter = () => p.h.app.get(ChannelAdapterRegistry).for('simulator');
const rejection = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return e as { code?: string; status?: number; getStatus?: () => number };
  }
  return null;
};

describe('a reply from the inbox', () => {
  it('is queued at once, sent by the worker, and ends read after the simulator receipts; the first response is stamped only when the provider accepted', async () => {
    const t = await p.api.signup('snd');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000001');
    const before = await conv(th.id);
    expect(before.waiting_since).not.toBeNull();
    expect(before.first_response_at).toBeNull();

    const admin = await listen(p, t.admin);
    await joinConversation(admin, th.uuid);

    const clientMessageId = randomUUID();
    const { message, replayed } = await send(t, th, text('Hi, how can I help?'), {
      clientMessageId,
    });
    expect(replayed).toBe(false);
    expect(message).toMatchObject({
      status: 'queued',
      direction: 'out',
      kind: 'text',
      body: 'Hi, how can I help?',
      seq: 2,
      clientMessageId,
      sender: { kind: 'agent', userId: expect.any(String) },
    });

    const done = await waitStatus(message.id, 'read');
    expect(done.provider_message_id).toMatch(/^sim\./);
    expect(done.sent_at).not.toBeNull();
    expect(done.delivered_at).not.toBeNull();
    expect(new Date(done.delivered_at as string).getTime()).toBeGreaterThanOrEqual(
      new Date(done.sent_at as string).getTime(),
    );

    // The log: queued, one attempt BEFORE the provider was called, the provider's acceptance, then the receipts the simulator sent.
    const log = await events(done.id as string);
    expect(log.slice(0, 3).map((e) => e.event)).toEqual(['queued', 'attempt', 'sent']);
    expect(log.map((e) => e.event)).toEqual(expect.arrayContaining(['delivered', 'read']));
    // Its `sent` receipt arrived after the dispatcher had already moved the row: recorded, not applied.
    const sentReceipt = log.filter((e) => e.event === 'sent')[1];
    expect(sentReceipt?.detail.applied).toBe(false);

    // The thread: the wait is over, the first response is the provider's acceptance, the unread count is untouched.
    const after = await conv(th.id);
    expect(after.last_outbound_at).not.toBeNull();
    expect(after.first_response_at).not.toBeNull();
    expect(after.waiting_since).toBeNull();
    expect(after.unread_count).toBe(before.unread_count);
    expect(after.preview).toBe('Hi, how can I help?');
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM conversation_events WHERE conversation_id = $1 AND type = 'first_response'`,
        [th.id],
      ),
    ).toBe(1);
    // Both ids are in the ledger: the client's (idempotent send) and the provider's (receipt routing).
    expect(
      (
        await p.h.owner.query(
          `SELECT kind, key FROM message_ledger WHERE message_id = $1 AND kind = ANY('{client_id,provider_id}') ORDER BY kind`,
          [done.id],
        )
      ).rows,
    ).toEqual([
      { kind: 'client_id', key: clientMessageId },
      { kind: 'provider_id', key: done.provider_message_id },
    ]);

    // A second reply does not move the first response.
    const firstResponse = after.first_response_at;
    const second = await send(t, th, text('Anything else?'));
    await waitStatus(second.message.id, 'read');
    expect((await conv(th.id)).first_response_at).toEqual(firstResponse);

    // The open thread saw the bubble appear and every tick, in order, with the client id the optimistic bubble is swapped by.
    await until(
      'ticks',
      () =>
        eventsOf(admin, 'inbox.message.status').filter((e) => e.payload.messageId === message.id)
          .length >= 3 || undefined,
    );
    const ticks = eventsOf(admin, 'inbox.message.status').filter(
      (e) => e.payload.messageId === message.id,
    );
    expect(ticks.map((e) => e.payload.status)).toEqual(['sent', 'delivered', 'read']);
    expect(ticks.every((e) => e.payload.clientMessageId === clientMessageId)).toBe(true);
    const bubble = eventsOf(admin, 'inbox.message.new').find(
      (e) => (e.payload.message as { id: string }).id === message.id,
    );
    expect(bubble?.payload.message).toMatchObject({ status: 'queued', seq: 2, clientMessageId });
  }, 60_000);

  it('the same client message id twice, even at once, is one message and one send; reusing it on another thread is refused', async () => {
    const t = await p.api.signup('idem');
    const ch = await simChannel(p, t);
    const a = await thread(t, ch, '919900000002');
    const b = await thread(t, ch, '919900000003');
    const spy = vi.spyOn(simAdapter(), 'send');
    const clientMessageId = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 6 }, () => send(t, a, text('once'), { clientMessageId })),
    );
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.message.id)).size).toBe(1);
    await waitStatus(results[0]!.message.id, 'read');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(
      await scalar(p, `SELECT count(*)::int AS n FROM messages WHERE client_message_id = $1`, [
        clientMessageId,
      ]),
    ).toBe(1);
    expect((await conv(a.id)).msg_seq).toBe(2);

    const reused = await rejection(() => send(t, b, text('other thread'), { clientMessageId }));
    expect(reused).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  }, 60_000);

  it('stores a reply to a message of the same thread, and refuses to reply to one of another', async () => {
    const t = await p.api.signup('rep');
    const ch = await simChannel(p, t);
    const a = await thread(t, ch, '919900000004');
    const b = await thread(t, ch, '919900000005');
    const inbound = (await messagesOf(p, a.id))[0]!;
    const { message } = await send(t, a, text('replying'), {
      replyToMessageId: inbound.uuid as string,
    });
    expect((await row(message.id)).reply_to_message_uuid).toBe(inbound.uuid);
    expect(message.replyToMessageId).toBe(inbound.uuid);
    const foreign = (await messagesOf(p, b.id))[0]!;
    expect(
      await rejection(() => send(t, a, text('x'), { replyToMessageId: foreign.uuid as string })),
    ).toMatchObject({
      code: 'MESSAGE_NOT_FOUND',
    });
  }, 60_000);
});

describe('receipts', () => {
  it('out of order (read, then delivered, then sent) the status never goes backwards and the log still holds all three', async () => {
    const t = await p.api.signup('ooo');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000010');
    const { message } = await send(t, th, text('/ooo scrambled'));

    // Watch the summary column the whole way: it may only rise.
    const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };
    let high = 0;
    const deadline = Date.now() + 15_000;
    let last = '';
    while (last !== 'read' && Date.now() < deadline) {
      last = (await row(message.id)).status as string;
      expect(rank[last], `unexpected status ${last}`).toBeGreaterThanOrEqual(high);
      high = rank[last] ?? high;
      await sleep(25);
    }
    expect(last).toBe('read');
    await sleep(1_500); // the late `delivered` and `sent` receipts arrive after `read`
    const done = await row(message.id);
    expect(done.status).toBe('read');
    expect(done.delivered_at).not.toBeNull(); // the refused `delivered` still told us when
    const log = (await events(done.id as string)).filter((e) =>
      ['sent', 'delivered', 'read'].includes(e.event),
    );
    expect(log.map((e) => [e.event, e.detail.applied])).toEqual([
      ['sent', undefined], // the dispatcher's own acceptance (not a receipt: it carries no `applied`)
      ['read', true],
      ['delivered', false],
      ['sent', false],
    ]);
  }, 60_000);

  it('a late "delivered" or "failed" for a read message changes nothing; a "failed" for a sent one fails it for good', async () => {
    const t = await p.api.signup('late');
    const ch = await simChannel(p, t, {
      simulator: { latencyMs: { sent: 0, delivered: 30_000, read: 40_000 } },
    });
    const th = await thread(t, ch, '919900000011');

    const slow = await send(t, th, text('slow ticks'));
    const sent = await waitStatus(slow.message.id, 'sent');
    const force = (
      providerMessageId: string,
      status: string,
      extra: Record<string, unknown> = {},
    ) =>
      p.api
        .as(t.admin)
        .post(`/v2/dev/simulator/channels/${ch.id}/receipt`)
        .send({ providerMessageId, status, ...extra });

    expect(
      (
        await force(sent.provider_message_id as string, 'failed', {
          errorCode: '131026',
          errorMessage: 'Undeliverable',
        })
      ).status,
    ).toBe(202);
    const failed = await waitStatus(slow.message.id, 'failed');
    expect(failed).toMatchObject({ failure_code: '131026', failure_reason: 'Undeliverable' });
    // Nothing leaves failed by a receipt.
    await force(sent.provider_message_id as string, 'read');
    await sleep(800);
    expect((await row(slow.message.id)).status).toBe('failed');

    const fine = await send(t, th, text('this one is delivered'));
    const ok = await waitStatus(fine.message.id, 'sent');
    await force(ok.provider_message_id as string, 'read');
    await waitStatus(fine.message.id, 'read');
    await force(ok.provider_message_id as string, 'failed');
    await force(ok.provider_message_id as string, 'delivered');
    await sleep(800);
    const still = await row(fine.message.id);
    expect(still.status).toBe('read');
    expect(still.failure_code).toBeNull();
  }, 60_000);
});

describe('a send that fails', () => {
  it('/fail ends failed with the reason, stamps no first response and ends no wait; Retry puts the same message back, never a second one', async () => {
    const t = await p.api.signup('fail');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000020');
    const admin = await listen(p, t.admin);
    await joinConversation(admin, th.uuid);

    const { message } = await send(t, th, text('/fail nope'));
    const failed = await waitStatus(message.id, 'failed');
    expect(failed).toMatchObject({ failure_code: 'SIM_REJECTED' });
    expect(failed.provider_message_id).toBeNull();
    const c = await conv(th.id);
    expect(c.first_response_at).toBeNull(); // Reference stamped it here
    expect(c.last_outbound_at).toBeNull();
    expect(c.waiting_since).not.toBeNull(); // the customer is still waiting
    expect((await events(failed.id as string)).map((e) => e.event)).toEqual([
      'queued',
      'attempt',
      'failed',
    ]);
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM message_ledger WHERE message_id = $1 AND kind = 'provider_id'`,
        [failed.id],
      ),
    ).toBe(0);
    await until(
      'the failed tick',
      () =>
        eventsOf(admin, 'inbox.message.status').some(
          (e) => e.payload.messageId === message.id && e.payload.status === 'failed',
        ) || undefined,
    );

    const retried = await asUser(t.orgId, t.adminUserId, () => facade.retryOutbound(message.id));
    expect(retried).toMatchObject({
      id: message.id,
      status: 'queued',
      failure: null,
      seq: message.seq,
    });
    await until('failed again', async () => {
      const r = await row(message.id);
      return r.status === 'failed' &&
        (await events(r.id as string)).filter((e) => e.event === 'failed').length === 2
        ? r
        : undefined;
    });
    expect((await events(failed.id as string)).map((e) => e.event)).toEqual([
      'queued',
      'attempt',
      'failed',
      'retry',
      'attempt',
      'failed',
    ]);
    // Still one message, one seq.
    expect(await messagesOf(p, th.id)).toHaveLength(2);

    // Only a failed outbound message can be retried; an unknown one is not found.
    const delivered = await send(t, th, text('fine'));
    await waitStatus(delivered.message.id, 'read');
    expect(
      await rejection(() =>
        asUser(t.orgId, t.adminUserId, () => facade.retryOutbound(delivered.message.id)),
      ),
    ).toMatchObject({
      code: 'MESSAGE_NOT_RETRYABLE',
    });
    expect(
      await rejection(() =>
        asUser(t.orgId, t.adminUserId, () => facade.retryOutbound(randomUUID())),
      ),
    ).toMatchObject({
      code: 'MESSAGE_NOT_FOUND',
    });
  }, 90_000);

  it('/flaky is retried by the queue with backoff and ends sent: one message, three attempts, two retries logged', async () => {
    const t = await p.api.signup('flaky');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000021');
    const spy = vi.spyOn(simAdapter(), 'send');
    const { message } = await send(t, th, text('/flaky maybe'));
    const done = await waitStatus(message.id, 'read', 45_000);
    expect(done.provider_message_id).toMatch(/^sim\./);
    const log = (await events(done.id as string)).map((e) => e.event);
    expect(log.filter((e) => e === 'attempt')).toHaveLength(3);
    expect(log.filter((e) => e === 'retry')).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(await messagesOf(p, th.id)).toHaveLength(2);
  }, 90_000);

  it('the emergency halt stops the send at the worker, even for a message already queued; after it is lifted Retry sends it', async () => {
    const t = await p.api.signup('halt');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000022');
    const halt = p.h.app.get(EmergencyHaltService);
    const spy = vi.spyOn(simAdapter(), 'send');

    await halt.set(true, operatorId);
    let uuid: string;
    try {
      ({
        message: { id: uuid },
      } = await send(t, th, text('while halted')));
      const failed = await waitStatus(uuid, 'failed');
      expect(failed.failure_code).toBe('AUTH_SEND_HALTED');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      await halt.set(false, operatorId);
    }
    const retried = await asUser(t.orgId, t.adminUserId, () => facade.retryOutbound(uuid!));
    expect(retried.status).toBe('queued');
    await waitStatus(uuid!, 'read');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await messagesOf(p, th.id)).toHaveLength(2);
  }, 90_000);
});

describe('what is refused before anything is stored', () => {
  it('SERVICE_WINDOW_CLOSED: free-form text and media after 24 hours, no row created; a template is allowed, and a new customer message opens the window again', async () => {
    const t = await p.api.signup('win');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000030', {
      sentAt: new Date(Date.now() - 30 * HOUR).toISOString(),
    });
    const messagesBefore = (await messagesOf(p, th.id)).length;

    for (const content of [
      text('too late'),
      {
        kind: 'media' as const,
        media: {
          key: `chat/${t.orgId}/2026/10/x.png`,
          mime: 'image/png',
          size: 10,
          name: 'x.png',
          sha256: 'a'.repeat(64),
        },
      },
    ]) {
      const err = await rejection(() => send(t, th, content));
      expect(err).toMatchObject({ code: 'SERVICE_WINDOW_CLOSED' });
      expect(err?.getStatus?.()).toBe(422);
    }
    expect(await messagesOf(p, th.id)).toHaveLength(messagesBefore);

    const tpl = await send(t, th, {
      kind: 'template',
      name: 'welcome_back',
      language: 'en',
      variables: { '1': 'Asha' },
      body: 'Welcome back, Asha',
    });
    await waitStatus(tpl.message.id, 'read');
    expect(tpl.message).toMatchObject({
      kind: 'template',
      template: { name: 'welcome_back', language: 'en', variables: { '1': 'Asha' } },
    });

    await simInbound(p, t, ch, { from: '919900000030', text: 'I am back' });
    await until('window open', async () => {
      const c = await conv(th.id);
      return new Date(c.window_expires_at as string).getTime() > Date.now() ? c : undefined;
    });
    const ok = await send(t, th, text('now it works'));
    await waitStatus(ok.message.id, 'read');
  }, 90_000);

  it('CHANNEL_DISCONNECTED when the channel is off, CHANNEL_CAPABILITY_UNSUPPORTED when it cannot carry the kind', async () => {
    const t = await p.api.signup('chn');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000031');

    await p.h.owner.query(
      `UPDATE channels SET capabilities = '{"templates": false}' WHERE id = $1`,
      [ch.internalId],
    );
    expect(
      await rejection(() =>
        send(t, th, { kind: 'template', name: 'n', language: 'en', variables: {}, body: 'b' }),
      ),
    ).toMatchObject({ code: 'CHANNEL_CAPABILITY_UNSUPPORTED' });

    await p.h.owner.query(`UPDATE channels SET status = 'disconnected' WHERE id = $1`, [
      ch.internalId,
    ]);
    expect(await rejection(() => send(t, th, text('hello?')))).toMatchObject({
      code: 'CHANNEL_DISCONNECTED',
    });
    expect(await messagesOf(p, th.id)).toHaveLength(1);
  }, 60_000);

  it("PLAN_LIMIT_REACHED at the monthly cap, counting only this month's messages that did not fail; the simulator is never metered", async () => {
    const t = await p.api.signup('cap');
    await p.h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"monthly_messages":2}}' WHERE org_id = $1`,
      [t.orgId],
    );

    // A metered channel: WhatsApp Cloud (connected by the owner connection; its adapter cannot send yet, which is not the point here).
    const created = await p.api
      .as(t.admin)
      .post('/v2/channels')
      .send({
        kind: 'whatsapp_cloud',
        name: 'Metered',
        credentials: {
          phoneNumberId: '6000000001',
          accessToken: 'EAAB-secret-token-1122',
          appSecret: 'app-secret-123456',
        },
      });
    expect(created.status).toBe(201);
    const wa = Number(
      (await p.h.owner.query(`SELECT id FROM channels WHERE uuid = $1`, [created.body.id])).rows[0]
        .id,
    );
    await p.h.owner.query(`UPDATE channels SET status = 'connected' WHERE id = $1`, [wa]);
    const waConv = (
      await p.h.owner.query(
        `INSERT INTO conversations (org_id, channel_id, peer_key, title, last_inbound_at, window_expires_at)
         VALUES ($1,$2,'919900000040','Metered thread', now(), now() + interval '1 day') RETURNING id, uuid`,
        [t.orgId, wa],
      )
    ).rows[0];
    const th: Thread = { id: Number(waConv.id), uuid: waConv.uuid as string };
    const put = (seq: number, status: string, createdAt = 'now()') =>
      p.h.owner.query(
        `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, body, created_at)
         VALUES ($1,$2,$3,'out','agent',$4,'x', ${createdAt})`,
        [t.orgId, th.id, seq, status],
      );
    await put(1, 'sent');
    await put(2, 'delivered');
    await put(3, 'failed'); // a failed message does not count
    await put(4, 'sent', `now() - interval '40 days'`); // neither does last month's
    await p.h.owner.query(`UPDATE conversations SET msg_seq = 4 WHERE id = $1`, [th.id]);

    const err = await rejection(() => send(t, th, text('one too many')));
    expect(err).toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    expect(err?.getStatus?.()).toBe(422);
    expect(
      await scalar(p, `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1`, [
        th.id,
      ]),
    ).toBe(4);

    // Room again (cap 3): the same send is accepted and stored; the WhatsApp adapter then refuses (not live), so it ends failed.
    await p.h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"monthly_messages":3}}' WHERE org_id = $1`,
      [t.orgId],
    );
    const ok = await send(t, th, text('fits now'));
    expect(ok.message.status).toBe('queued');
    expect((await waitStatus(ok.message.id, 'failed')).failure_code).toBe('CHANNEL_NOT_LIVE');

    // The simulator is a development tool: it never spends the allowance, however low the cap.
    await p.h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"monthly_messages":1}}' WHERE org_id = $1`,
      [t.orgId],
    );
    const ch = await simChannel(p, t);
    const sim = await thread(t, ch, '919900000041');
    for (let i = 0; i < 3; i += 1) {
      const r = await send(t, sim, text(`free ${i}`));
      expect(r.message.status).toBe('queued');
    }
  }, 90_000);
});

describe('a worker that dies mid-send', () => {
  it('crashing after the provider accepted but before the commit: the retry reuses the stored answer, the provider is called once, one message', async () => {
    const t = await p.api.signup('kill1');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000050');
    const spy = vi.spyOn(simAdapter(), 'send');
    const real = p.h.app.get(MessageDispatchService) as unknown as {
      markSent: (...a: unknown[]) => Promise<void>;
    };
    const crash = vi
      .spyOn(real, 'markSent')
      .mockRejectedValueOnce(new Error('process killed before commit'));

    const clientMessageId = randomUUID();
    const { message } = await send(t, th, text('survive me'), { clientMessageId });
    const done = await waitStatus(message.id, 'read', 45_000);

    expect(crash).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledTimes(1); // the second attempt was answered from the stored result
    expect(
      await scalar(p, `SELECT count(*)::int AS n FROM messages WHERE client_message_id = $1`, [
        clientMessageId,
      ]),
    ).toBe(1);
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM message_ledger WHERE message_id = $1 AND kind = 'provider_id'`,
        [done.id],
      ),
    ).toBe(1);
    const log = (await events(done.id as string)).map((e) => e.event);
    expect(log.filter((e) => e === 'attempt')).toHaveLength(2);
    expect((await conv(th.id)).first_response_at).not.toBeNull();
  }, 90_000);

  it('a message stored queued whose job never reached the queue is picked up by the recovery sweep, once', async () => {
    const t = await p.api.signup('rec');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000052');
    // The enqueue is lost (the API process "died" after the commit, or Redis refused the job): the message is stored, no job exists.
    const queue = (
      p.h.app.get(OutboundService) as unknown as {
        queue: { add: (...a: unknown[]) => Promise<unknown> };
      }
    ).queue;
    const add = vi.spyOn(queue, 'add').mockRejectedValueOnce(new Error('redis went away'));

    const { message } = await send(t, th, text('lost in transit'));
    expect(add).toHaveBeenCalledTimes(1);
    await sleep(1_500);
    expect((await row(message.id)).status).toBe('queued'); // nobody is sending it

    const sweeper = p.h.app.get(QueuedMessageRecoveryService);
    expect(await sweeper.sweep(0)).toBeGreaterThanOrEqual(1);
    const done = await waitStatus(message.id, 'read');
    // Nothing left to recover; the message was sent once.
    expect(await sweeper.sweep(0)).toBe(0);
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM message_ledger WHERE message_id = $1 AND kind = 'provider_id'`,
        [done.id],
      ),
    ).toBe(1);
    expect(await messagesOf(p, th.id)).toHaveLength(2);
  }, 90_000);
});

describe('another workspace', () => {
  it('cannot read, send on, mark read, or retry what belongs to this one: every answer is a plain not found', async () => {
    const a = await p.api.signup('xtA');
    const b = await p.api.signup('xtB');
    const chA = await simChannel(p, a);
    const thA = await thread(a, chA, '919900000060');
    const { message } = await send(a, thA, text('/fail private'));
    await waitStatus(message.id, 'failed');

    const asB = <T>(fn: () => Promise<T>) => asUser(b.orgId, b.adminUserId, fn);
    for (const attempt of [
      () => asB(() => facade.listMessages(thA.uuid, { limit: 50 })),
      () => asB(() => facade.markRead(thA.uuid, 1)),
      () =>
        asB(() =>
          facade.enqueueOutbound({
            conversationId: thA.uuid,
            clientMessageId: randomUUID(),
            content: text('hi'),
          }),
        ),
    ]) {
      const err = await rejection(attempt);
      expect(err).toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
      expect(err?.getStatus?.()).toBe(404);
    }
    const retry = await rejection(() => asB(() => facade.retryOutbound(message.id)));
    expect(retry).toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
    expect(retry?.getStatus?.()).toBe(404);
    expect((await row(message.id)).status).toBe('failed');
    expect(await asB(() => facade.findThread(chA.id, '919900000060'))).toBeNull();
  }, 60_000);
});

// Last on purpose: it stops the in-app send worker and runs two of its own.
describe('a worker killed while the provider call is in flight', () => {
  it('a worker killed while the provider call is in flight: another worker finishes the job, and the thread has one row for the message', async () => {
    const t = await p.api.signup('kill2');
    const ch = await simChannel(p, t);
    const th = await thread(t, ch, '919900000051');

    // Only the "doomed" worker may take the job: stop the in-app one for good (this test runs last).
    const inApp = p.h.app.get(MessageDispatchProcessor);
    await inApp.worker.close();
    const url = new URL(process.env.REDIS_URL!);
    const connection = { host: url.hostname, port: Number(url.port) };
    const options = { connection, lockDuration: 1_500, stalledInterval: 500, maxStalledCount: 3 };

    // The provider call hangs the first time (the process is "killed" inside it), then behaves.
    const sim = simAdapter();
    const realSend = sim.send.bind(sim);
    let calls = 0;
    const entered = new Promise<void>((resolve) => {
      vi.spyOn(sim, 'send').mockImplementation(async (channel, envelope) => {
        calls += 1;
        if (calls === 1) {
          resolve();
          return new Promise(() => undefined);
        }
        return realSend(channel, envelope);
      });
    });

    const doomed = new Worker(
      QUEUES.MESSAGE_DISPATCH,
      (job, token) => inApp.process(job, token),
      options,
    );
    const clientMessageId = randomUUID();
    const { message } = await send(t, th, text('killed in flight'), { clientMessageId });
    await entered;

    // Kill it: no graceful close, the job's lock is simply never renewed. The dead worker's send lock stays in Redis until it
    // expires (60 s in production); fast-forward that here instead of waiting a minute.
    await doomed.close(true);
    for (const key of await p.h.redis.keys('chat:dispatch:*:lock'))
      await p.h.redis.pexpire(key, 100);

    const rescuer = new Worker(
      QUEUES.MESSAGE_DISPATCH,
      (job, token) => inApp.process(job, token),
      options,
    );
    try {
      const done = await waitStatus(message.id, 'read', 60_000);
      expect(done.provider_message_id).toMatch(/^sim\./);
      expect(
        await scalar(p, `SELECT count(*)::int AS n FROM messages WHERE client_message_id = $1`, [
          clientMessageId,
        ]),
      ).toBe(1);
      expect(await messagesOf(p, th.id)).toHaveLength(2);
      expect(
        await scalar(
          p,
          `SELECT count(*)::int AS n FROM message_ledger WHERE message_id = $1 AND kind = 'provider_id'`,
          [done.id],
        ),
      ).toBe(1);
      // The documented residual risk: the provider call was repeated (it never answered the first time).
      expect(calls).toBe(2);
      expect(
        (await events(done.id as string)).filter((e) => e.event === 'attempt').length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      await rescuer.close();
    }
  }, 120_000);
});
