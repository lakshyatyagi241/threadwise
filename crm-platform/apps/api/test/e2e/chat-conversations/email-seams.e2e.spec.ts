import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
} from '../../../src/modules/chat-conversations';
import { ChannelAdapterRegistry } from '../../../src/modules/chat-conversations/channel-adapter.registry';
import { EmailMessageAccess } from '../../../src/modules/chat-conversations/email-message-access.service';
import {
  InboundMessageHooks,
  type InboundMessageListener,
} from '../../../src/modules/chat-conversations/inbound-hooks';
import { InboundIngestService } from '../../../src/modules/chat-conversations/inbound-ingest.service';
import type { Tenant } from '../contacts-attributes-tags/support';
import { FakeEmailAdapter } from './fake-email-adapter';
import {
  asUser,
  scalar,
  simChannel,
  simInbound,
  conversationOf,
  startPipeline,
  until,
  type Pipeline,
} from './pipeline-support';

/**
 * The inbox core seams the email channel plugs into, end to end: an inbound mail (kind email, a thread key, a title, the sender as the
 * contact identity, `meta.email`) becomes ONE conversation per thread, a reply with cc/bcc/subject is dispatched with the thread
 * headers, and automated mail triggers nothing. The real email adapter is another module's; a fake one with the contract's capabilities
 * stands in. Real Postgres (restricted role), Redis and BullMQ workers in the same process.
 */
let p: Pipeline;
let t: Tenant;
let channelUuid: string;
let channelId: number;
const adapter = new FakeEmailAdapter();

beforeAll(async () => {
  p = await startPipeline();
  p.h.app.get(ChannelAdapterRegistry).register(adapter);
  t = await p.api.signup('mail');
  const res = await p.h.owner.query(
    `INSERT INTO channels (org_id, kind, name, status, display_address, settings)
     VALUES ($1, 'email', 'Support mailbox', 'connected', 'support@shop.test', '{"metered": false}'::jsonb)
     RETURNING id, uuid`,
    [t.orgId],
  );
  channelId = Number(res.rows[0].id);
  channelUuid = res.rows[0].uuid as string;
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

const system = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 'spec-system', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
    fn,
  );

let counter = 0;
const emailMeta = (over: Record<string, unknown> = {}) => ({
  subject: 'Invoice question',
  from: { name: 'Ada', address: 'ada@example.com' },
  to: [{ name: null, address: 'support@shop.test' }],
  messageId: `m${++counter}@example.com`,
  references: [],
  threadId: 'thread-a',
  html: '<p>Where is my invoice?</p>',
  ...over,
});

const inbound = (thread: string, over: Record<string, unknown> = {}, metaOver = {}) =>
  system(() =>
    p.h.app.get(InboundIngestService).ingest({
      orgId: t.orgId,
      channelUuid,
      message: {
        providerMessageId: `gmail.${randomUUID()}`,
        peerKey: `t:${thread}`,
        peerName: 'Ada',
        title: 'Invoice question',
        contactIdentity: { kind: 'email', value: 'Ada@Example.com', name: 'Ada' },
        kind: 'text',
        body: 'Where is my invoice?',
        meta: { email: emailMeta({ threadId: thread, ...metaOver }) },
        providerTimestamp: new Date().toISOString(),
        ...over,
      } as never,
    }),
  );

const convRows = async (thread: string) =>
  (
    await p.h.owner.query(
      `SELECT * FROM conversations WHERE org_id = $1 AND channel_id = $2 AND peer_key = $3`,
      [t.orgId, channelId, `t:${thread}`],
    )
  ).rows as Array<Record<string, unknown>>;

const messagesIn = async (conversationId: unknown) =>
  (
    await p.h.owner.query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq`, [
      conversationId,
    ])
  ).rows as Array<Record<string, unknown>>;

const contactsByEmail = (email: string) =>
  scalar(p, `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND normalized_email = $2`, [
    t.orgId,
    email,
  ]);

describe('inbound mail becomes one conversation per thread', () => {
  it('creates ONE conversation with the subject as title, the sender as peer name, and the contact linked by email', async () => {
    const r = await inbound('thread-a');
    expect(r).toMatchObject({ outcome: 'stored', createdConversation: true });
    const rows = await convRows('thread-a');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Invoice question', peer_name: 'Ada' });
    expect(rows[0]!.contact_id).not.toBeNull();
    expect(rows[0]!.needs_contact).toBe(false);
    expect(await contactsByEmail('ada@example.com')).toBe(1);

    const [msg] = await messagesIn(rows[0]!.id);
    expect(msg).toMatchObject({ direction: 'in', status: 'received' });
    expect((msg!.meta as { email: { subject: string; html: string } }).email).toMatchObject({
      subject: 'Invoice question',
      html: '<p>Where is my invoice?</p>',
    });
  });

  it('the next mail of the thread lands in it, keeps the first title, and reopens a resolved thread', async () => {
    const [before] = await convRows('thread-a');
    await p.h.owner.query(
      `UPDATE conversations SET status = 'resolved', resolved_at = now() WHERE id = $1`,
      [before!.id],
    );
    const r = await inbound(
      'thread-a',
      { title: 'Re: Invoice question' },
      { subject: 'Re: Invoice question' },
    );
    expect(r).toMatchObject({
      outcome: 'stored',
      createdConversation: false,
      reopenedFrom: 'resolved',
    });
    const rows = await convRows('thread-a');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'open', title: 'Invoice question' });
    expect(await messagesIn(rows[0]!.id)).toHaveLength(2);
    expect(await contactsByEmail('ada@example.com')).toBe(1);
  });

  it('a different thread id opens a new conversation for the same contact', async () => {
    const r = await inbound('thread-b', { title: 'Another topic' }, { subject: 'Another topic' });
    expect(r).toMatchObject({ outcome: 'stored', createdConversation: true });
    const [a] = await convRows('thread-a');
    const [b] = await convRows('thread-b');
    expect(b).toMatchObject({ title: 'Another topic' });
    expect(b!.id).not.toBe(a!.id);
    expect(b!.contact_id).toBe(a!.contact_id);
    expect(await contactsByEmail('ada@example.com')).toBe(1);
  });

  it('a redelivery of the same mail is a duplicate: nothing is stored twice', async () => {
    const providerMessageId = `gmail.${randomUUID()}`;
    const first = await inbound('thread-c', { providerMessageId });
    expect(first).toMatchObject({ outcome: 'stored' });
    const again = await inbound('thread-c', { providerMessageId });
    expect(again).toEqual({ outcome: 'duplicate' });
    const [c] = await convRows('thread-c');
    expect(await messagesIn(c!.id)).toHaveLength(1);
  });

  it('a mail with no subject and no sender name gets a readable title, and one without an identity has no contact', async () => {
    const r = await inbound('thread-d', {
      title: undefined,
      peerName: undefined,
      contactIdentity: undefined,
    });
    expect(r).toMatchObject({ outcome: 'stored', createdConversation: true });
    const [d] = await convRows('thread-d');
    expect(d).toMatchObject({ title: '(no subject)', contact_id: null });
  });

  it('keeps the email block through the thread API, and refuses it on a channel that is not email', async () => {
    const [a] = await convRows('thread-a');
    const res = await p.api
      .as(t.admin)
      .get(`/v2/inbox/conversations/${a!.uuid as string}/messages`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data[0].email).toMatchObject({ subject: 'Invoice question' });

    // The same meta from a simulator channel is dropped: only email gets the larger email budget and key.
    const sim = await simChannel(p, t);
    await simInbound(p, t, sim, { from: '919811111111', name: 'Sim', text: 'hi' });
    const conv = await conversationOf(p, t, sim, '919811111111');
    const sent = await p.api
      .as(t.admin)
      .get(`/v2/inbox/conversations/${conv.uuid as string}/messages`);
    expect(sent.body.data[0].email ?? null).toBeNull();
  });
});

describe('inbound hooks on email', () => {
  const listener = (name: string, extra: Partial<InboundMessageListener> = {}) => {
    const onStored = vi.fn(async () => ({ consumed: false }));
    return { name, onStored, ...extra } as InboundMessageListener & { onStored: typeof onStored };
  };
  const answering = listener('spec-auto-reply');
  const routing = listener('spec-routing', { runsOnEmail: true });

  beforeAll(() => {
    const hooks = p.h.app.get(InboundMessageHooks);
    hooks.register(answering);
    hooks.register(routing);
  });

  it('an ordinary mail reaches only a listener that opted in; no auto-reply listener (flows, keywords) runs on email', async () => {
    await inbound('thread-e');
    expect(routing.onStored).toHaveBeenCalledTimes(1);
    expect(answering.onStored).not.toHaveBeenCalled();
  });

  it('an automated mail is stored but reaches no listener at all', async () => {
    routing.onStored.mockClear();
    const r = await inbound('thread-e', {}, { automated: true, subject: 'Out of office' });
    expect(r).toMatchObject({ outcome: 'stored' });
    expect(routing.onStored).not.toHaveBeenCalled();
    expect(answering.onStored).not.toHaveBeenCalled();
    const [e] = await convRows('thread-e');
    expect(await messagesIn(e!.id)).toHaveLength(2);
  });
});

describe('a reply on an email conversation', () => {
  const post = (uuid: string, body: Record<string, unknown>) =>
    p.api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${uuid}/messages`)
      .send({ kind: 'text', clientMessageId: randomUUID(), ...body });

  it('is dispatched with the thread headers, the sender as recipient and the extras, and replays without sending twice', async () => {
    await inbound(
      'thread-f',
      { title: 'Refund' },
      { subject: 'Refund', messageId: 'orig@example.com', references: ['root@example.com'] },
    );
    const [f] = await convRows('thread-f');
    const clientMessageId = randomUUID();
    const body = {
      body: 'We have refunded you.',
      clientMessageId,
      email: { cc: ['boss@shop.test'], bcc: ['audit@shop.test'], subject: 'Your refund' },
    };
    const res = await post(f!.uuid as string, body);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    await until('sent', async () => {
      const r = await p.h.owner.query(`SELECT status FROM messages WHERE uuid = $1`, [res.body.id]);
      return r.rows[0]?.status === 'sent' ? true : undefined;
    });
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0]).toMatchObject({
      kind: 'text',
      body: 'We have refunded you.',
      clientReference: clientMessageId,
      email: {
        to: ['ada@example.com'],
        cc: ['boss@shop.test'],
        bcc: ['audit@shop.test'],
        subject: 'Your refund',
        inReplyTo: 'orig@example.com',
        references: ['root@example.com', 'orig@example.com'],
        threadId: 'thread-f',
      },
    });
    const stored = await p.h.owner.query(`SELECT meta FROM messages WHERE uuid = $1`, [
      res.body.id,
    ]);
    expect(stored.rows[0].meta.emailReply).toEqual({
      cc: ['boss@shop.test'],
      bcc: ['audit@shop.test'],
      subject: 'Your refund',
    });

    // The same client id again: the first message, nothing sent twice.
    const again = await post(f!.uuid as string, body);
    expect(again.status).toBe(202);
    expect(again.body.id).toBe(res.body.id);
    expect(adapter.sent).toHaveLength(1);
  });

  it('defaults the subject to Re: <original> and sends no cc or bcc; a long body is accepted on email', async () => {
    adapter.sent.length = 0;
    await inbound('thread-g', {}, { subject: 'Quote request' });
    const [g] = await convRows('thread-g');
    const long = 'a'.repeat(20_000);
    const res = await post(g!.uuid as string, { body: long });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    await until('sent', async () => (adapter.sent.length === 1 ? true : undefined));
    expect(adapter.sent[0]).toMatchObject({
      body: long,
      email: { subject: 'Re: Quote request', cc: [], bcc: [], to: ['ada@example.com'] },
    });
    const over = await post(g!.uuid as string, { body: 'a'.repeat(100_001) });
    expect(over.status).toBe(422);
  });

  it('is not metered: no window, no cap, even with no recent customer mail', async () => {
    const [g] = await convRows('thread-g');
    await p.h.owner.query(
      `UPDATE conversations SET last_inbound_at = now() - interval '90 days' WHERE id = $1`,
      [g!.id],
    );
    const res = await post(g!.uuid as string, { body: 'Following up' });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
  });

  it('cc, bcc and a subject are refused on a conversation that is not email', async () => {
    const sim = await simChannel(p, t);
    await simInbound(p, t, sim, { from: '919822222222', name: 'Sim', text: 'hi' });
    const conv = await conversationOf(p, t, sim, '919822222222');
    const res = await post(conv.uuid as string, { body: 'hello', email: { cc: ['a@x.test'] } });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND direction = 'out'`,
        [conv.id],
      ),
    ).toBe(0);
  });

  it('a contact with no thread yet cannot be messaged first on an email channel', async () => {
    const seeded = await p.api.seedContacts(t, [
      { name: 'Nobody Yet', email: 'nobody@example.com' },
    ]);
    const facade = p.h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
    const err = (await asUser(t.orgId, t.adminUserId, () =>
      facade.openConversationFor(seeded[0]!, channelUuid),
    ).catch((e: unknown) => e)) as { code?: string; message?: string };
    expect(err.code).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
    expect(err.message).toMatch(/customer email/);
  });
});

describe("EmailMessageAccess (the attachment route's visibility check)", () => {
  const access = () => p.h.app.get(EmailMessageAccess);

  it('returns the email block to someone who may read the conversation, and nothing otherwise', async () => {
    const [a] = await convRows('thread-a');
    const [m] = await messagesIn(a!.id);
    const ok = await access().readable(a!.uuid as string, m!.uuid as string, {
      orgId: t.orgId,
      userId: t.adminUserId,
    });
    expect(ok?.email.subject).toBe('Invoice question');
    expect(ok?.conversationId).toBe(Number(a!.id));

    // A message that is not in the named conversation.
    const [b] = await convRows('thread-b');
    expect(
      await access().readable(b!.uuid as string, m!.uuid as string, {
        orgId: t.orgId,
        userId: t.adminUserId,
      }),
    ).toBeNull();

    // Someone with no read grant, and someone whose scope excludes this (unassigned-to-them, "own") conversation.
    const none = await p.api.member(t, 'nogrant', []);
    expect(
      await access().readable(a!.uuid as string, m!.uuid as string, {
        orgId: t.orgId,
        userId: none.userId,
      }),
    ).toBeNull();
    const own = await p.api.member(t, 'ownonly', [['inbox.conversation.read', 'own']]);
    await p.h.owner.query(`UPDATE conversations SET assignee_user_id = $2 WHERE id = $1`, [
      a!.id,
      t.adminUserId,
    ]);
    expect(
      await access().readable(a!.uuid as string, m!.uuid as string, {
        orgId: t.orgId,
        userId: own.userId,
      }),
    ).toBeNull();
  });

  it('is null for a message without an email block', async () => {
    const [f] = await convRows('thread-f');
    const out = (
      await p.h.owner.query(
        `SELECT uuid FROM messages WHERE conversation_id = $1 AND direction = 'out' LIMIT 1`,
        [f!.id],
      )
    ).rows[0];
    expect(
      await access().readable(f!.uuid as string, out.uuid as string, {
        orgId: t.orgId,
        userId: t.adminUserId,
      }),
    ).toBeNull();
  });
});
