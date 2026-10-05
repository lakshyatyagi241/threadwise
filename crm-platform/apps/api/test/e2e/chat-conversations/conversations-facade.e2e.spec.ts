import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
} from '../../../src/modules/chat-conversations';
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
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from './pipeline-support';

/**
 * The facade other domains call (plan 3.1): reading a thread page by page, marking it read, the thread lookups and the recorder for
 * messages another domain sent, and the media route's rule that a link stops working when its holder loses the conversation.
 */
let p: Pipeline;
let facade: ConversationsFacade;

beforeAll(async () => {
  p = await startPipeline();
  facade = p.h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

const READ = (scope: 'all' | 'team' | 'own'): Grant[] => [['inbox.conversation.read', scope]];
const asAdmin = <T>(t: Tenant, fn: () => Promise<T>) => asUser(t.orgId, t.adminUserId, fn);
const rejection = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return e as { code?: string; getStatus?: () => number };
  }
  return null;
};

async function threadWith(
  t: Tenant,
  ch: SimChannel,
  peer: string,
  count: number,
): Promise<{ uuid: string; id: number }> {
  for (let i = 1; i <= count; i += 1) {
    await simInbound(p, t, ch, { from: peer, text: `message ${i}` });
    // One at a time keeps the order of the arrivals the order of the numbers.
    await until(`message ${i}`, async () => {
      const c = await p.h.owner.query(
        `SELECT count(*)::int AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.org_id = $1 AND c.peer_key = $2`,
        [t.orgId, peer],
      );
      return c.rows[0].n >= i ? true : undefined;
    });
  }
  const conv = await conversationOf(p, t, ch, peer);
  return { uuid: conv.uuid as string, id: conv.id as number };
}

describe('listMessages: a thread, page by page, with no gap', () => {
  let t: Tenant;
  let th: { uuid: string; id: number };

  beforeAll(async () => {
    t = await p.api.signup('lst');
    const ch = await simChannel(p, t);
    th = await threadWith(t, ch, '919700000001', 7);
  }, 60_000);

  const page = (query: { limit: number; before?: number; afterSeq?: number }) =>
    asAdmin(t, () => facade.listMessages(th.uuid, query));
  const seqs = (r: Awaited<ReturnType<typeof page>>) => r.data.map((m) => m.seq);

  it('without a cursor: the newest page, oldest first', async () => {
    const r = await page({ limit: 3 });
    expect(seqs(r)).toEqual([5, 6, 7]);
    expect(r.page).toEqual({ hasMoreBefore: true, hasMoreAfter: false, limit: 3 });
    expect(r.data[2]).toMatchObject({
      body: 'message 7',
      direction: 'in',
      status: 'received',
      conversationId: th.uuid,
    });
  });

  it('before: older messages, walking back to the start', async () => {
    const a = await page({ limit: 3, before: 5 });
    expect(seqs(a)).toEqual([2, 3, 4]);
    expect(a.page).toMatchObject({ hasMoreBefore: true, hasMoreAfter: true });
    const b = await page({ limit: 3, before: 2 });
    expect(seqs(b)).toEqual([1]);
    expect(b.page.hasMoreBefore).toBe(false);
  });

  it('afterSeq: only the newer ones, oldest first, for filling a gap after a reconnect', async () => {
    const a = await page({ limit: 50, afterSeq: 5 });
    expect(seqs(a)).toEqual([6, 7]);
    expect(a.page).toMatchObject({ hasMoreBefore: true, hasMoreAfter: false });
    const b = await page({ limit: 3, afterSeq: 0 });
    expect(seqs(b)).toEqual([1, 2, 3]);
    expect(b.page).toMatchObject({ hasMoreBefore: false, hasMoreAfter: true });
    expect(seqs(await page({ limit: 50, afterSeq: 7 }))).toEqual([]);
  });

  it('every page is gap-free: the pages together are every seq once', async () => {
    const all: number[] = [];
    let after = 0;
    for (;;) {
      const r = await page({ limit: 2, afterSeq: after });
      all.push(...seqs(r));
      if (!r.page.hasMoreAfter) break;
      after = all[all.length - 1]!;
    }
    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('an unknown conversation is a plain 404', async () => {
    const err = await rejection(() =>
      asAdmin(t, () => facade.listMessages(randomUUID(), { limit: 5 })),
    );
    expect(err).toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
    expect(err?.getStatus?.()).toBe(404);
  });
});

describe('markRead', () => {
  it('unread becomes the customer messages after the seq: a message that arrived while reading stays unread, and it never goes up', async () => {
    const t = await p.api.signup('rd');
    const ch = await simChannel(p, t);
    const th = await threadWith(t, ch, '919700000002', 5);
    const unread = async () =>
      Number(
        (await p.h.owner.query(`SELECT unread_count FROM conversations WHERE id = $1`, [th.id]))
          .rows[0].unread_count,
      );
    expect(await unread()).toBe(5);

    const admin = await listen(p, t.admin);
    expect(await asAdmin(t, () => facade.markRead(th.uuid, 3))).toEqual({ unreadCount: 2 });
    expect(await unread()).toBe(2);
    await until('the unread signal', () => eventsOf(admin, 'inbox.unread')[0]);
    expect(eventsOf(admin, 'inbox.unread')[0]!.payload).toMatchObject({
      conversationId: th.uuid,
      unread: 2,
    });

    expect(await asAdmin(t, () => facade.markRead(th.uuid, 1))).toEqual({ unreadCount: 2 }); // reading less never un-reads
    expect(await asAdmin(t, () => facade.markRead(th.uuid, 5))).toEqual({ unreadCount: 0 });
    expect(await asAdmin(t, () => facade.markRead(th.uuid, 99))).toEqual({ unreadCount: 0 });
    expect(await unread()).toBe(0);
  }, 90_000);
});

describe('threads for other domains', () => {
  it('openConversationFor makes the perpetual thread of a contact on a phone channel, once; findThread finds it by the peer however it is written', async () => {
    const t = await p.api.signup('opn');
    const ch = await simChannel(p, t);
    const [withPhone, noPhone] = await p.api.seedContacts(t, [
      { name: 'Reachable', phone: '+919700000010' },
      { name: 'No number', phone: null },
    ]);

    const a = await asAdmin(t, () => facade.openConversationFor(withPhone!, ch.id));
    const b = await asAdmin(t, () => facade.openConversationFor(withPhone!, ch.id));
    expect(b).toEqual(a);
    expect(a).toMatchObject({ channelId: ch.id, peerKey: '919700000010' });
    const row = (await p.h.owner.query(`SELECT * FROM conversations WHERE uuid = $1`, [a.id]))
      .rows[0];
    expect(row).toMatchObject({ title: 'Reachable', status: 'open', needs_contact: false });
    expect(row.contact_id).not.toBeNull();
    expect(
      await scalar(p, `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1`, [t.orgId]),
    ).toBe(1);
    expect((await p.api.events(t.orgId, 'conversation.created')).length).toBe(1);

    expect(await asAdmin(t, () => facade.findThread(ch.id, '+91 97000 00010'))).toEqual(a);
    expect(await asAdmin(t, () => facade.findThread(ch.id, '919700000099'))).toBeNull();

    expect(
      await rejection(() => asAdmin(t, () => facade.openConversationFor(noPhone!, ch.id))),
    ).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(
      await rejection(() => asAdmin(t, () => facade.openConversationFor(randomUUID(), ch.id))),
    ).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(
      await rejection(() => asAdmin(t, () => facade.openConversationFor(withPhone!, randomUUID()))),
    ).toMatchObject({
      code: 'NOT_FOUND',
    });
  }, 60_000);

  it("recordOutbound writes a message another domain sent as sent, without touching the customer's wait; the same provider id again is the same message", async () => {
    const t = await p.api.signup('rec');
    const ch = await simChannel(p, t);
    const th = await threadWith(t, ch, '919700000011', 1);
    const before = (await p.h.owner.query(`SELECT * FROM conversations WHERE id = $1`, [th.id]))
      .rows[0];
    expect(before.waiting_since).not.toBeNull();

    const input = {
      channelId: ch.id,
      peerKey: '919700000011',
      source: 'broadcast',
      body: 'Diwali sale starts today',
      providerMessageId: `wamid.bcast.${randomUUID()}`,
    };
    const first = await asAdmin(t, () => facade.recordOutbound(input));
    const again = await asAdmin(t, () => facade.recordOutbound(input));
    expect(again.messageId).toBe(first.messageId);
    expect(first.thread).toMatchObject({ id: th.uuid, peerKey: '919700000011' });

    const rows = await messagesOf(p, th.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      direction: 'out',
      status: 'sent',
      sender_kind: 'broadcast',
      body: 'Diwali sale starts today',
      seq: 2,
      provider_message_id: input.providerMessageId,
    });
    const after = (await p.h.owner.query(`SELECT * FROM conversations WHERE id = $1`, [th.id]))
      .rows[0];
    expect(after.last_outbound_at).not.toBeNull();
    expect(after.preview).toBe('Diwali sale starts today');
    // A campaign is not a human answer: the customer is still waiting, nothing was read, no first response.
    expect(after.waiting_since).toEqual(before.waiting_since);
    expect(after.first_response_at).toBeNull();
    expect(after.unread_count).toBe(before.unread_count);

    // And it creates the thread when there is none (without a contact it knows nothing about).
    const fresh = await asAdmin(t, () =>
      facade.recordOutbound({
        channelId: ch.id,
        peerKey: '+91 97000 00012',
        source: 'flow',
        body: 'Hello from a flow',
      }),
    );
    expect(fresh.thread.peerKey).toBe('919700000012');
    const created = (
      await p.h.owner.query(`SELECT * FROM conversations WHERE uuid = $1`, [fresh.thread.id])
    ).rows[0];
    expect(created).toMatchObject({ unread_count: 0, needs_contact: false });
    expect(created.contact_id).toBeNull();
  }, 90_000);
});

describe('who may open a file', () => {
  it('a link made for an agent stops working when the conversation is no longer theirs, and for a role that lost the right', async () => {
    const t = await p.api.signup('med');
    const ch = await simChannel(p, t);
    const agent = await p.api.member(t, 'agent', READ('own'));
    const other = await p.api.member(t, 'other', READ('own'));
    await simInbound(p, t, ch, {
      from: '919700000020',
      kind: 'media',
      text: 'my id card',
      media: { mediaKind: 'image', mime: 'image/png', name: 'id.png' },
    });
    const conv = await conversationOf(p, t, ch, '919700000020');
    await until('stored', async () => (await messagesOf(p, conv.id as number)).length === 1);
    await p.h.owner.query(`UPDATE conversations SET assignee_user_id = $2 WHERE id = $1`, [
      conv.id,
      agent.userId,
    ]);

    // The agent's own link (the inbox mints it for them after its visibility check).
    const mint = async (userId: number) =>
      (
        await asUser(t.orgId, userId, () => facade.listMessages(conv.uuid as string, { limit: 10 }))
      ).data[0]!.media!.url.replace('/api', '');
    const link = await mint(agent.userId);
    const get = (token: string, url: string) => p.api.as(token).get(url);

    expect((await get(agent.token, link)).status).toBe(200);
    // A link is for one person: the same url in another agent's hands is not found.
    expect((await get(other.token, link)).status).toBe(404);

    // Reassigned to someone else: the agent's link, still unexpired, no longer opens.
    await p.h.owner.query(`UPDATE conversations SET assignee_user_id = $2 WHERE id = $1`, [
      conv.id,
      other.userId,
    ]);
    expect((await get(agent.token, link)).status).toBe(404);
    expect((await get(other.token, await mint(other.userId))).status).toBe(200);
    // An administrator (read scope all) still sees it.
    expect((await get(t.admin, await mint(t.adminUserId))).status).toBe(200);
  }, 90_000);
});

describe('joining a thread over the socket still follows the same rule', () => {
  it('the person who may see a conversation is let into its room, the one who may not is refused', async () => {
    const t = await p.api.signup('rm');
    const ch = await simChannel(p, t);
    const agent = await p.api.member(t, 'agent', READ('own'));
    const th = await threadWith(t, ch, '919700000030', 1);
    const stranger = await listen(p, agent.token);
    expect(await joinConversation(stranger, th.uuid)).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    await p.h.owner.query(`UPDATE conversations SET assignee_user_id = $2 WHERE id = $1`, [
      th.id,
      agent.userId,
    ]);
    expect(await joinConversation(stranger, th.uuid)).toMatchObject({ ok: true });
  }, 60_000);
});

/** WD-I18N-038: the thread shows a stored translation only while translation is live for the workspace. */
describe('listMessages: translation display gate (WD-I18N-038)', () => {
  it('shows the stored reading while the switch is on, hides it (keeping the language) when off, and shows it again after', async () => {
    const t = await p.api.signup('xl8');
    const ch = await simChannel(p, t);
    const th = await threadWith(t, ch, '919700000077', 1);
    await p.h.owner.query(
      `UPDATE messages SET is_translated = true, translated_body = 'Where is my order?', detected_language = 'es'
       WHERE org_id = $1 AND conversation_id = $2`,
      [t.orgId, th.id],
    );
    // A signed-up workspace owns its plan until one is assigned, so the plan gate is open; the workspace switch decides.
    const setSwitch = (on: boolean) =>
      p.h.owner.query(
        `INSERT INTO workspace_settings (org_id, inbox_translate) VALUES ($1, $2)
         ON CONFLICT (org_id) DO UPDATE SET inbox_translate = EXCLUDED.inbox_translate`,
        [t.orgId, on],
      );
    const first = async () =>
      (await asAdmin(t, () => facade.listMessages(th.uuid, { limit: 10 }))).data[0]!;

    await setSwitch(true);
    expect(await first()).toMatchObject({
      isTranslated: true,
      translatedBody: 'Where is my order?',
      detectedLanguage: 'es',
    });
    await setSwitch(false);
    expect(await first()).toMatchObject({
      isTranslated: false,
      translatedBody: null,
      detectedLanguage: 'es',
    });
    await setSwitch(true);
    expect((await first()).translatedBody).toBe('Where is my order?');
  }, 60_000);
});
