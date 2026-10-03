import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
} from '../../../src/modules/chat-conversations';
import { InboundIngestService } from '../../../src/modules/chat-conversations/inbound-ingest.service';
import { ReceiptsService } from '../../../src/modules/chat-conversations/receipts.service';
import { WabaIngestService } from '../../../src/modules/whatsapp-cloud-api-waba/waba-ingest.service';
import { splitWebhook } from '../../../src/modules/whatsapp-cloud-api-waba/waba-rules';
import type { Grant, Tenant } from '../contacts-attributes-tags/support';
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
import { connectNumber } from './whatsapp-support';

/**
 * The inbound pipeline end to end (plan-inbox-chat.md 3.4): a customer message from the simulator, or from the WhatsApp webhook,
 * goes through the queue, the ingest processor and the database, and comes out as a contact, a thread and a message, announced to the
 * right people only. A WhatsApp delivery arrives through the WABA domain's webhook ingest, which hands it to the inbox's sink. Real Postgres (restricted role), real Redis, real BullMQ workers in the same process, real sockets.
 */
let p: Pipeline;

beforeAll(async () => {
  p = await startPipeline();
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

const READ = (scope: 'all' | 'team' | 'own'): Grant[] => [['inbox.conversation.read', scope]];
const DAY = 24 * 3_600_000;

const system = <T>(orgId: number, fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 'spec-system', orgId, actorType: 'system', actorId: null, userId: null },
    fn,
  );

const ingest = (t: Tenant, ch: SimChannel, message: Record<string, unknown>) =>
  system(t.orgId, () =>
    p.h.app.get(InboundIngestService).ingest({
      orgId: t.orgId,
      channelUuid: ch.id,
      message: {
        providerMessageId: `spec.${randomUUID()}`,
        peerKey: '919800000000',
        kind: 'text',
        body: 'hi',
        providerTimestamp: new Date().toISOString(),
        ...message,
      } as never,
    }),
  );

const contactCount = (t: Tenant, phone: string) =>
  scalar(p, `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND phone = $2`, [
    t.orgId,
    phone,
  ]);

const outbox = async (t: Tenant, type: string, conversationUuid?: string) => {
  const rows = await p.api.events(t.orgId, type);
  return conversationUuid ? rows.filter((r) => r.uuid === conversationUuid) : rows;
};

describe('a customer message from the simulator', () => {
  let t: Tenant;
  let ch: SimChannel;

  beforeAll(async () => {
    t = await p.api.signup('ing');
    ch = await simChannel(p, t);
  });

  it('creates the contact, the conversation and the message, once, with the thread state the inbox needs', async () => {
    const before = Date.now();
    await simInbound(p, t, ch, { from: '919800000001', name: 'Asha', text: 'Hello there' });
    const conv = await conversationOf(p, t, ch, '919800000001');
    await until('the message', async () => (await messagesOf(p, conv.id as number)).length === 1);

    const fresh = (await conversationOf(p, t, ch, '919800000001')) as Record<string, unknown>;
    expect(fresh).toMatchObject({
      peer_key: '919800000001',
      peer_name: 'Asha',
      title: 'Asha',
      status: 'open',
      unread_count: 1,
      msg_seq: 1,
      preview: 'Hello there',
      needs_contact: false,
    });
    expect(fresh.contact_id).not.toBeNull();
    expect(new Date(fresh.last_inbound_at as string).getTime()).toBeGreaterThanOrEqual(
      before - 2000,
    );
    // The 24 hour window is the customer's last message plus the channel's window; the wait starts with the first unanswered one.
    expect(
      new Date(fresh.window_expires_at as string).getTime() -
        new Date(fresh.last_inbound_at as string).getTime(),
    ).toBe(DAY);
    expect(fresh.waiting_since).not.toBeNull();
    expect(fresh.first_response_at).toBeNull();
    expect(fresh.last_outbound_at).toBeNull();

    const [m] = await messagesOf(p, conv.id as number);
    expect(m).toMatchObject({
      seq: 1,
      direction: 'in',
      kind: 'text',
      sender_kind: 'customer',
      status: 'received',
      body: 'Hello there',
    });
    expect(m!.provider_ts).not.toBeNull();
    expect(m!.provider_message_id).toMatch(/^sim\.in\./);

    // The contact is the person behind the number, found or created by identity, with the same key the contacts module writes.
    const contact = (
      await p.h.owner.query(`SELECT name, phone, source FROM contacts WHERE id = $1`, [
        fresh.contact_id,
      ])
    ).rows[0];
    expect(contact).toMatchObject({ name: 'Asha', phone: '+919800000001', source: 'inbox' });
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM contact_identities WHERE org_id = $1 AND kind = 'phone' AND value = '+919800000001' AND contact_id = $2`,
        [t.orgId, fresh.contact_id],
      ),
    ).toBe(1);

    // Lifecycle, in the same transaction as the write: a timeline event, an audit row, an outbox event. Messages are not outbox events.
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM conversation_events WHERE conversation_id = $1 AND type = 'created'`,
        [conv.id],
      ),
    ).toBe(1);
    expect(await outbox(t, 'conversation.created', fresh.uuid as string)).toHaveLength(1);
    expect(await outbox(t, 'conversation.created')).toHaveLength(1);
    expect(await p.api.auditCount(t.orgId, 'conversations', 'insert')).toBe(1);
    expect(await outbox(t, 'contact.created')).toHaveLength(1);
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM channels WHERE id = $1 AND last_event_at IS NOT NULL`,
        [ch.internalId],
      ),
    ).toBe(1);
    // The ledger holds the provider id: that is what makes a redelivery a no-op and routes a receipt.
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM message_ledger WHERE org_id = $1 AND kind = 'provider_id' AND conversation_id = $2`,
        [t.orgId, conv.id],
      ),
    ).toBe(1);
  });

  it('a second message from the same sender, written another way, joins the same thread and the same contact', async () => {
    const r = await ingest(t, ch, {
      peerKey: '+91 98000-00001',
      body: 'second',
      peerName: 'Asha K',
    });
    expect(r).toMatchObject({ outcome: 'stored', seq: 2, createdConversation: false });
    const conv = await conversationOf(p, t, ch, '919800000001');
    expect(conv).toMatchObject({
      unread_count: 2,
      msg_seq: 2,
      preview: 'second',
      peer_name: 'Asha K',
    });
    expect(await contactCount(t, '+919800000001')).toBe(1);
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND peer_key = '919800000001'`,
        [t.orgId],
      ),
    ).toBe(1);
    // The thread did not announce itself again.
    expect(await outbox(t, 'conversation.created', conv.uuid as string)).toHaveLength(1);
  });

  it('links a contact that already exists (found by its stored number, and the identity is healed), never a duplicate', async () => {
    await p.api.seedContacts(t, [{ name: 'Old Customer', phone: '+919800000002' }]);
    await simInbound(p, t, ch, { from: '919800000002', name: 'Someone Else', text: 'it is me' });
    const conv = await conversationOf(p, t, ch, '919800000002');
    await until('linked', async () => (await messagesOf(p, conv.id as number)).length === 1);
    const linked = (
      await p.h.owner.query(
        `SELECT c.name FROM conversations v JOIN contacts c ON c.id = v.contact_id WHERE v.id = $1`,
        [conv.id],
      )
    ).rows[0];
    expect(linked.name).toBe('Old Customer');
    expect(await contactCount(t, '+919800000002')).toBe(1);
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM contact_identities WHERE org_id = $1 AND value = '+919800000002'`,
        [t.orgId],
      ),
    ).toBe(1);
  });

  it('a customer message reopens a resolved, closed or snoozed thread, and not a spam one; the reopening is announced', async () => {
    const conv = await conversationOf(p, t, ch, '919800000001');
    const id = conv.id as number;
    await p.h.owner.query(
      `UPDATE conversations SET status = 'resolved', resolved_at = now() WHERE id = $1`,
      [id],
    );
    const r = await ingest(t, ch, { peerKey: '919800000001', body: 'one more thing' });
    expect(r).toMatchObject({ outcome: 'stored', reopenedFrom: 'resolved' });
    const reopened = await conversationOf(p, t, ch, '919800000001');
    expect(reopened).toMatchObject({ status: 'open', resolved_at: null });
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM conversation_events WHERE conversation_id = $1 AND type = 'reopened'`,
        [id],
      ),
    ).toBe(1);
    expect(await outbox(t, 'conversation.reopened', conv.uuid as string)).toHaveLength(1);

    await p.h.owner.query(
      `UPDATE conversations SET status = 'snoozed', snoozed_until = now() + interval '1 day' WHERE id = $1`,
      [id],
    );
    expect(await ingest(t, ch, { peerKey: '919800000001', body: 'ping' })).toMatchObject({
      reopenedFrom: 'snoozed',
    });
    expect(await conversationOf(p, t, ch, '919800000001')).toMatchObject({
      status: 'open',
      snoozed_until: null,
    });

    await p.h.owner.query(`UPDATE conversations SET status = 'spam' WHERE id = $1`, [id]);
    expect(await ingest(t, ch, { peerKey: '919800000001', body: 'buy now' })).toMatchObject({
      outcome: 'stored',
      reopenedFrom: null,
    });
    expect(await conversationOf(p, t, ch, '919800000001')).toMatchObject({ status: 'spam' });
  });

  it('the window follows the newest customer message: a late, older delivery never shortens it', async () => {
    const recent = new Date(Date.now() - 2 * 3_600_000);
    await ingest(t, ch, {
      peerKey: '919800000003',
      body: 'recent',
      providerTimestamp: recent.toISOString(),
    });
    await ingest(t, ch, {
      peerKey: '919800000003',
      body: 'older, late',
      providerTimestamp: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    });
    const conv = await conversationOf(p, t, ch, '919800000003');
    expect(new Date(conv.last_inbound_at as string).getTime()).toBe(recent.getTime());
    expect(new Date(conv.window_expires_at as string).getTime()).toBe(recent.getTime() + DAY);
    // The customer's clock cannot stretch it either: a provider timestamp in the future is the arrival.
    await ingest(t, ch, {
      peerKey: '919800000004',
      body: 'from the future',
      providerTimestamp: new Date(Date.now() + 10 * DAY).toISOString(),
    });
    const future = await conversationOf(p, t, ch, '919800000004');
    expect(new Date(future.window_expires_at as string).getTime()).toBeLessThanOrEqual(
      Date.now() + DAY,
    );
  });

  it('a location message keeps the place, and the preview says so', async () => {
    await simInbound(p, t, ch, {
      from: '919800000005',
      kind: 'location',
      location: { latitude: 19.076, longitude: 72.8777, name: 'Mumbai office' },
    });
    const conv = await conversationOf(p, t, ch, '919800000005');
    await until('stored', async () => (await messagesOf(p, conv.id as number)).length === 1);
    const [m] = await messagesOf(p, conv.id as number);
    expect(m).toMatchObject({ kind: 'location', body: null });
    expect(Number(m!.latitude)).toBeCloseTo(19.076, 3);
    expect((await conversationOf(p, t, ch, '919800000005')).preview).toBe('📍 Mumbai office');
  });

  it('a photo is stored through the media door; the thread shows it as a link made for the reader, never the storage key', async () => {
    await simInbound(p, t, ch, {
      from: '919800000006',
      kind: 'media',
      text: 'look at this',
      media: { mediaKind: 'image', mime: 'image/png', name: 'receipt.png' },
    });
    const conv = await conversationOf(p, t, ch, '919800000006');
    await until('stored', async () => (await messagesOf(p, conv.id as number)).length === 1);
    const [m] = await messagesOf(p, conv.id as number);
    expect(m).toMatchObject({
      kind: 'image',
      body: 'look at this',
      media_mime: 'image/png',
      media_name: 'receipt.png',
    });
    expect(m!.media_key).toMatch(new RegExp(`^chat/${t.orgId}/\\d{4}/\\d{2}/`));
    expect((await conversationOf(p, t, ch, '919800000006')).preview).toBe('look at this');

    const facade = p.h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
    const page = await asUser(t.orgId, t.adminUserId, () =>
      facade.listMessages(conv.uuid as string, { limit: 50 }),
    );
    const wire = page.data[0]!;
    expect(wire.media?.url).toMatch(/^\/api\/v2\/media\/.+/);
    expect(JSON.stringify(wire)).not.toContain(m!.media_key as string);
    const file = await p.api.as(t.admin).get(wire.media!.url.replace('/api', ''));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
  });
});

describe('duplicates and concurrency', () => {
  let t: Tenant;
  let ch: SimChannel;

  beforeAll(async () => {
    t = await p.api.signup('dup');
    ch = await simChannel(p, t);
  });

  it('the same provider message delivered 20 times at once produces one message', async () => {
    const providerMessageId = `spec.dup.${randomUUID()}`;
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () =>
        ingest(t, ch, { peerKey: '919810000001', providerMessageId, body: 'only once' }),
      ),
    );
    expect(outcomes.filter((o) => o.outcome === 'stored')).toHaveLength(1);
    expect(outcomes.filter((o) => o.outcome === 'duplicate')).toHaveLength(19);
    const conv = await conversationOf(p, t, ch, '919810000001');
    expect(await messagesOf(p, conv.id as number)).toHaveLength(1);
    expect(conv).toMatchObject({ unread_count: 1, msg_seq: 1 });
    expect(await contactCount(t, '+919810000001')).toBe(1);
    expect(await outbox(t, 'conversation.created', conv.uuid as string)).toHaveLength(1);
  });

  it('a redelivery long after the first (the queue has forgotten the job id) is still a no-op', async () => {
    const providerMessageId = `spec.late.${randomUUID()}`;
    await ingest(t, ch, { peerKey: '919810000002', providerMessageId });
    expect(await ingest(t, ch, { peerKey: '919810000002', providerMessageId })).toEqual({
      outcome: 'duplicate',
    });
    const conv = await conversationOf(p, t, ch, '919810000002');
    expect(await messagesOf(p, conv.id as number)).toHaveLength(1);
  });

  it('the simulator /dup fault delivers one message three times through the real queue and the thread has it once', async () => {
    const r = await simInbound(p, t, ch, { from: '919810000003', text: '/dup say it thrice' });
    expect(r.deliveries).toBe(3);
    const conv = await conversationOf(p, t, ch, '919810000003');
    await until('stored', async () => (await messagesOf(p, conv.id as number)).length >= 1);
    // Give the other two jobs time to run, then prove none of them added a message.
    await sleep(1_500);
    const rows = await messagesOf(p, conv.id as number);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe('say it thrice');
  });

  it('16 messages at once from a brand-new sender (the most the connection pool can hold at once): one thread, one contact, 16 distinct gap-free sequence numbers', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        ingest(t, ch, { peerKey: '919810000016', body: `m${i}` }),
      ),
    );
    expect(outcomes.every((o) => o.outcome === 'stored')).toBe(true);
    expect(outcomes.filter((o) => o.outcome === 'stored' && o.createdConversation)).toHaveLength(1);

    const conv = await conversationOf(p, t, ch, '919810000016');
    const seqs = (await messagesOf(p, conv.id as number)).map((m) => Number(m.seq));
    expect(seqs).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(conv).toMatchObject({ msg_seq: 16, unread_count: 16 });
    expect(await contactCount(t, '+919810000016')).toBe(1);
    expect(await outbox(t, 'conversation.created', conv.uuid as string)).toHaveLength(1);
  }, 60_000);

  it('50 messages at once from a brand-new sender through the real queue (the workers take eight at a time): one thread, one contact, 50 distinct gap-free sequence numbers', async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        simInbound(p, t, ch, { from: '919810000050', text: `m${i}` }),
      ),
    );
    const conv = await conversationOf(p, t, ch, '919810000050');
    await until(
      'all 50 stored',
      async () => (await messagesOf(p, conv.id as number)).length === 50,
      60_000,
    );

    const seqs = (await messagesOf(p, conv.id as number)).map((m) => Number(m.seq));
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(await conversationOf(p, t, ch, '919810000050')).toMatchObject({
      msg_seq: 50,
      unread_count: 50,
    });
    expect(await contactCount(t, '+919810000050')).toBe(1);
    expect(
      await scalar(
        p,
        `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND peer_key = '919810000050'`,
        [t.orgId],
      ),
    ).toBe(1);
    expect(await outbox(t, 'conversation.created', conv.uuid as string)).toHaveLength(1);
  }, 120_000);
});

describe('the contact cap never costs a message', () => {
  it('past the plan cap the message is kept on a thread without a contact, flagged; with room again the next message links one', async () => {
    const t = await p.api.signup('cap');
    const ch = await simChannel(p, t);
    // The signup may already have made a contact; count what is there so the cap is exactly "one more fits".
    const used = await scalar(p, `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [
      t.orgId,
    ]);
    await p.h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      t.orgId,
      JSON.stringify({ limits: { contacts: used + 1 } }),
    ]);

    await ingest(t, ch, { peerKey: '919820000001', body: 'first fits', peerName: 'One' });
    expect(await conversationOf(p, t, ch, '919820000001')).toMatchObject({ needs_contact: false });

    const r = await ingest(t, ch, { peerKey: '919820000002', body: 'no room', peerName: 'Two' });
    expect(r.outcome).toBe('stored');
    const capped = await conversationOf(p, t, ch, '919820000002');
    expect(capped).toMatchObject({ contact_id: null, needs_contact: true, unread_count: 1 });
    expect(await messagesOf(p, capped.id as number)).toHaveLength(1);
    expect(await contactCount(t, '+919820000002')).toBe(0);

    await p.h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      t.orgId,
      JSON.stringify({ limits: { contacts: used + 10 } }),
    ]);
    await ingest(t, ch, { peerKey: '919820000002', body: 'now there is room' });
    const linked = await conversationOf(p, t, ch, '919820000002');
    expect(linked).toMatchObject({ needs_contact: false });
    expect(linked.contact_id).not.toBeNull();
    expect(await contactCount(t, '+919820000002')).toBe(1);
  });
});

describe('who is told', () => {
  it('a new message reaches the people who may see the thread and nobody else; the open thread gets the message itself', async () => {
    const t = await p.api.signup('rt');
    const ch = await simChannel(p, t);
    const owner = await p.api.member(t, 'owner', READ('own'));
    const stranger = await p.api.member(t, 'stranger', READ('own'));
    const reader = await p.api.member(t, 'reader', READ('all'));

    await simInbound(p, t, ch, { from: '919830000001', text: 'first' });
    const conv = await conversationOf(p, t, ch, '919830000001');
    await until('stored', async () => (await messagesOf(p, conv.id as number)).length === 1);
    await p.h.owner.query(`UPDATE conversations SET assignee_user_id = $2 WHERE id = $1`, [
      conv.id,
      owner.userId,
    ]);

    const admin = await listen(p, t.admin);
    const mine = await listen(p, owner.token);
    const other = await listen(p, stranger.token);
    const all = await listen(p, reader.token);
    const joined = await joinConversation(admin, conv.uuid as string);
    expect(joined).toMatchObject({ ok: true });

    await simInbound(p, t, ch, { from: '919830000001', text: 'second' });
    await until(
      'the signals',
      () => eventsOf(mine, 'inbox.conversation.upsert').length > 0 || undefined,
    );
    await sleep(400);

    for (const who of [admin, mine, all]) {
      const upsert = eventsOf(who, 'inbox.conversation.upsert');
      expect(upsert).toHaveLength(1);
      expect(upsert[0]!.payload).toMatchObject({ conversationId: conv.uuid });
      expect(upsert[0]!.payload.changed).toEqual(expect.arrayContaining(['lastMessage', 'unread']));
      expect(eventsOf(who, 'inbox.unread')[0]!.payload).toMatchObject({
        conversationId: conv.uuid,
        unread: 2,
      });
    }
    // "own" scope and not the assignee: told nothing, not even that something happened.
    expect(eventsOf(other, 'inbox.conversation.upsert')).toHaveLength(0);
    expect(eventsOf(other, 'inbox.unread')).toHaveLength(0);

    // A list signal carries no content; the open thread gets the message (to the room, not to the people).
    expect(JSON.stringify(eventsOf(mine, 'inbox.conversation.upsert'))).not.toContain('second');
    const newMessage = await until('message.new', () => eventsOf(admin, 'inbox.message.new')[0]);
    expect(newMessage.room).toBe(`conv:${conv.uuid}`);
    expect(newMessage.payload).toMatchObject({
      conversationId: conv.uuid,
      message: { seq: 2, direction: 'in', body: 'second', status: 'received' },
    });
    expect(eventsOf(mine, 'inbox.message.new')).toHaveLength(0);
  }, 60_000);
});

describe('the WhatsApp webhook feeds the same pipeline', () => {
  /** What Meta posts for one customer text on a number; the WABA domain splits it per change and routes it by the number's ids. */
  const delivery = (
    wabaId: string,
    phoneNumberId: string,
    text: string,
    waId = '919840000001',
  ) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: wabaId,
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: phoneNumberId },
              contacts: [{ wa_id: waId, profile: { name: 'Meera' } }],
              messages: [
                {
                  id: `wamid.hook.${randomUUID()}`,
                  from: waId,
                  type: 'text',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const feed = (payload: unknown) => p.h.app.get(WabaIngestService).process(splitWebhook(payload));

  it('a message for a connected number makes its channel, the thread, the contact and the message, attributed like a simulator one', async () => {
    const t = await p.api.signup('hook');
    const number = await connectNumber(p.h, t.orgId, {
      phoneNumberId: '5000000001',
      label: 'Hooked',
      phone: '+1 555 000 1111',
    });
    expect(
      await scalar(p, `SELECT count(*)::int AS n FROM channels WHERE org_id = $1`, [t.orgId]),
    ).toBe(0);

    const result = await feed(delivery(number.wabaId, number.phoneNumberId, 'hello from whatsapp'));
    expect(result).toEqual({ handled: 1, dropped: 0 });

    const channel = await p.h.owner.query(`SELECT * FROM channels WHERE org_id = $1`, [t.orgId]);
    expect(channel.rows).toHaveLength(1);
    expect(channel.rows[0]).toMatchObject({
      kind: 'whatsapp_cloud',
      name: 'Hooked',
      status: 'connected',
      external_id: '5000000001',
    });
    expect(Number(channel.rows[0].waba_config_id)).toBe(number.configId);
    const internal = Number(channel.rows[0].id);

    const conv = await until('the thread', async () => {
      const r = await p.h.owner.query(`SELECT * FROM conversations WHERE channel_id = $1`, [
        internal,
      ]);
      return r.rows[0] as Record<string, unknown> | undefined;
    });
    expect(conv).toMatchObject({ peer_key: '919840000001', peer_name: 'Meera', unread_count: 1 });
    const [m] = await until('the message', async () => {
      const rows = await messagesOf(p, conv.id as number);
      return rows.length > 0 ? rows : undefined;
    });
    expect(m).toMatchObject({ body: 'hello from whatsapp', direction: 'in', status: 'received' });
    // Meta's 24 hour window is the channel's capability, not the simulator's.
    expect(
      new Date(conv.window_expires_at as string).getTime() -
        new Date(conv.last_inbound_at as string).getTime(),
    ).toBe(DAY);
  }, 60_000);

  it('the same delivery twice stores one message (Meta redelivers): the WABA claim and the ledger both hold', async () => {
    const t = await p.api.signup('hookdup');
    const number = await connectNumber(p.h, t.orgId, { phoneNumberId: '5000000002' });
    const payload = delivery(number.wabaId, number.phoneNumberId, 'twice', '919840000002');
    await feed(payload);
    await feed(payload);
    const internal = Number(
      (await p.h.owner.query(`SELECT id FROM channels WHERE org_id = $1`, [t.orgId])).rows[0].id,
    );
    const conv = await until('the thread', async () => {
      const r = await p.h.owner.query(`SELECT id FROM conversations WHERE channel_id = $1`, [
        internal,
      ]);
      return r.rows[0] as { id: number } | undefined;
    });
    await sleep(800);
    expect(await messagesOf(p, conv.id)).toHaveLength(1);
  }, 60_000);

  it('a number nobody has connected is acknowledged and dropped: no channel, no thread', async () => {
    const t = await p.api.signup('hookno');
    const result = await feed(delivery('88000000999', '5000000999', 'who is this'));
    expect(result).toEqual({ handled: 0, dropped: 1 });
    expect(
      await scalar(p, `SELECT count(*)::int AS n FROM channels WHERE org_id = $1`, [t.orgId]),
    ).toBe(0);
  });

  it("another workspace's number never receives it: the message lands only in the workspace that owns the number", async () => {
    const a = await p.api.signup('hookA');
    const b = await p.api.signup('hookB');
    const na = await connectNumber(p.h, a.orgId, { phoneNumberId: '5000000011' });
    await connectNumber(p.h, b.orgId, { phoneNumberId: '5000000012' });
    await feed(delivery(na.wabaId, na.phoneNumberId, 'for A only', '919840000011'));
    await until(
      'A thread',
      async () =>
        (await scalar(p, `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1`, [
          a.orgId,
        ])) === 1 || undefined,
    );
    expect(
      await scalar(p, `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1`, [b.orgId]),
    ).toBe(0);
    expect(
      await scalar(p, `SELECT count(*)::int AS n FROM channels WHERE org_id = $1`, [b.orgId]),
    ).toBe(0);
  }, 60_000);
});

describe('receipts for a message nobody has', () => {
  it('are ignored: nothing is created, nothing is logged, the answer says unknown', async () => {
    const t = await p.api.signup('unk');
    const ch = await simChannel(p, t);
    const before = await scalar(
      p,
      `SELECT count(*)::int AS n FROM message_events WHERE org_id = $1`,
      [t.orgId],
    );
    const outcome = await system(t.orgId, () =>
      p.h.app.get(ReceiptsService).apply({
        orgId: t.orgId,
        channelUuid: ch.id,
        receipt: {
          providerMessageId: 'sim.nobody',
          status: 'delivered',
          at: new Date().toISOString(),
        },
      }),
    );
    expect(outcome).toBe('unknown');
    expect(
      await scalar(p, `SELECT count(*)::int AS n FROM message_events WHERE org_id = $1`, [t.orgId]),
    ).toBe(before);
  });

  it('another workspace cannot reach a message by guessing its provider id (the ledger is per channel and per tenant)', async () => {
    const a = await p.api.signup('rcA');
    const b = await p.api.signup('rcB');
    const chA = await simChannel(p, a);
    const chB = await simChannel(p, b);
    const facade = p.h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
    await ingest(a, chA, { peerKey: '919850000001', body: 'hello' });
    const conv = await conversationOf(p, a, chA, '919850000001');
    const sent = await asUser(a.orgId, a.adminUserId, () =>
      facade.enqueueOutbound({
        conversationId: conv.uuid as string,
        clientMessageId: randomUUID(),
        content: { kind: 'text', body: 'reply' },
      }),
    );
    const row = await until('sent', async () => {
      const r = await p.h.owner.query(
        `SELECT provider_message_id FROM messages WHERE uuid = $1 AND provider_message_id IS NOT NULL`,
        [sent.message.id],
      );
      return r.rows[0] as { provider_message_id: string } | undefined;
    });
    const stolen = await system(b.orgId, () =>
      p.h.app.get(ReceiptsService).apply({
        orgId: b.orgId,
        channelUuid: chB.id,
        receipt: {
          providerMessageId: row.provider_message_id,
          status: 'failed',
          at: new Date().toISOString(),
        },
      }),
    );
    expect(stolen).toBe('unknown');
    const after = await p.h.owner.query(`SELECT status FROM messages WHERE uuid = $1`, [
      sent.message.id,
    ]);
    expect(after.rows[0].status).not.toBe('failed');
  }, 60_000);
});
