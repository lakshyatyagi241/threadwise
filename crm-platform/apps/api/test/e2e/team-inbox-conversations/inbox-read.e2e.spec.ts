import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT, Api, Inbox, startHarness, uuidRe, type Harness, type Tenant } from './support';

/**
 * The inbox's read side through the whole app (plan-inbox-chat.md Phase 1, routes 9 to 12, 19, 20): the list with its tabs, filters,
 * search and cursor, the counts, the conversation header, the timeline, and who may see what. Each block works in an organization of
 * its own; conversations are arranged straight in the tables, so nothing here depends on the message pipeline.
 *
 * The simulator flag is set before the app is built (it is read at boot to bind the adapter).
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let h: Harness;
let api: Api;
let inbox: Inbox;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  inbox = new Inbox(h, api);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

interface Row {
  id: string;
  title: string;
  status: string;
  unreadCount: number;
  pinned: boolean;
  archived: boolean;
  preview: string | null;
  channel: { id: string; kind: string; name: string };
  assignment: { user: { id: string } | null; team: { id: string } | null };
  rowVersion: number;
}
interface Page {
  data: Row[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
  meta: { counts: Record<string, number> };
}

const list = async (token: string, qs = ''): Promise<Page> => {
  const res = await api.as(token).get(`/v2/inbox/conversations${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Page;
};
const ids = (p: Page) => p.data.map((r) => r.id);

describe('list: tabs, status, channel, archive and the counts that match them', () => {
  let t: Tenant;
  let agent: { token: string; userId: number };
  let ch: { id: string };
  let ch2: { id: string };
  const c: Record<string, string> = {};

  beforeAll(async () => {
    t = await api.signup('ibl');
    agent = await api.member(t, 'agent', AGENT);
    ch = await inbox.channel(t.admin, { name: 'Main' });
    ch2 = await inbox.channel(t.admin, { name: 'Second' });
    c.mine = (await inbox.conversation(t, ch.id, { assigneeUserId: agent.userId })).uuid;
    c.unassigned = (await inbox.conversation(t, ch.id, {})).uuid;
    c.unread = (await inbox.conversation(t, ch.id, { unread: 3 })).uuid;
    c.pending = (await inbox.conversation(t, ch.id, { status: 'pending' })).uuid;
    c.resolved = (await inbox.conversation(t, ch.id, { status: 'resolved' })).uuid;
    c.snoozed = (await inbox.conversation(t, ch.id, { status: 'snoozed' })).uuid;
    c.archived = (await inbox.conversation(t, ch.id, { archived: true, status: 'resolved' })).uuid;
    c.other = (await inbox.conversation(t, ch2.id, { assigneeUserId: t.adminUserId })).uuid;
    // A thread with nothing in it is not an inbox item.
    await inbox.conversation(t, ch.id, { messages: 0, lastMessageAt: null });
  });

  it('shows open and pending threads by default, newest activity first, as the summary shape the contract defines', async () => {
    const p = await list(agent.token);
    expect(new Set(ids(p))).toEqual(new Set([c.mine, c.unassigned, c.unread, c.pending, c.other]));
    const times = p.data.map((r) => r.id);
    expect(times).toHaveLength(5);
    const first = p.data[0]!;
    expect(first.id).toMatch(uuidRe);
    expect(first.channel.id).toMatch(uuidRe);
    expect(first.channel.kind).toBe('simulator');
    expect(typeof first.rowVersion).toBe('number');
    // Newest activity first: the thread seeded last is on top.
    expect(p.data[0]!.id).toBe(c.other);
  });

  it('tab mine / unassigned / unread narrow the same set; all is everything open or pending', async () => {
    expect(ids(await list(agent.token, '?tab=mine'))).toEqual([c.mine]);
    expect(new Set(ids(await list(agent.token, '?tab=unassigned')))).toEqual(
      new Set([c.unassigned, c.unread, c.pending]),
    );
    expect(ids(await list(agent.token, '?tab=unread'))).toEqual([c.unread]);
    expect(ids(await list(agent.token, '?tab=all'))).toHaveLength(5);
  });

  it('status filters: resolved, snoozed, all, and a status that does not exist is a validation error', async () => {
    expect(ids(await list(agent.token, '?status=resolved'))).toEqual([c.resolved]);
    expect(ids(await list(agent.token, '?status=snoozed'))).toEqual([c.snoozed]);
    expect(ids(await list(agent.token, '?status=all'))).toHaveLength(7);
    const bad = await api.as(agent.token).get('/v2/inbox/conversations?status=bogus');
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
  });

  it('the Resolved view lists closed threads too: to an agent they are one status', async () => {
    const t2 = await api.signup('ibl-rc');
    const agent2 = await api.member(t2, 'agent', AGENT);
    const ch3 = await inbox.channel(t2.admin, { name: 'Main' });
    const open = (await inbox.conversation(t2, ch3.id, {})).uuid;
    const resolved = (await inbox.conversation(t2, ch3.id, { status: 'resolved' })).uuid;
    const closed = (await inbox.conversation(t2, ch3.id, { status: 'closed' })).uuid;
    expect(new Set(ids(await list(agent2.token, '?status=resolved')))).toEqual(
      new Set([resolved, closed]),
    );
    // Neither shows in the default view, and open stays open.
    expect(ids(await list(agent2.token))).toEqual([open]);
    expect(ids(await list(agent2.token, '?status=open'))).toEqual([open]);
  });

  it('channel filter narrows to one channel; a channel of nobody narrows to nothing, not to everything', async () => {
    expect(ids(await list(agent.token, `?channelId=${ch2.id}`))).toEqual([c.other]);
    const stranger = await list(agent.token, '?channelId=0a5c1d92-1f64-4f9b-8a0e-0e8b6f5a77f1');
    expect(stranger.data).toEqual([]);
    expect(stranger.page.hasMore).toBe(false);
  });

  it('the Filters window: several statuses, Conversation, agents, oldest first and a date range', async () => {
    expect(new Set(ids(await list(agent.token, '?statuses=resolved,snoozed')))).toEqual(
      new Set([c.resolved, c.snoozed]),
    );
    expect(new Set(ids(await list(agent.token, '?statuses=open,pending')))).toEqual(
      new Set([c.mine, c.unassigned, c.unread, c.pending, c.other]),
    );
    expect((await api.as(agent.token).get('/v2/inbox/conversations?statuses=bogus')).status).toBe(
      422,
    );
    expect(new Set(ids(await list(agent.token, '?assignment=assigned')))).toEqual(
      new Set([c.mine, c.other]),
    );
    expect(new Set(ids(await list(agent.token, '?assignment=unassigned')))).toEqual(
      new Set([c.unassigned, c.unread, c.pending]),
    );
    expect(ids(await list(agent.token, '?assignment=unattended'))).toEqual([c.unread]);
    const who = await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [agent.userId]);
    expect(ids(await list(agent.token, `?agentIds=${who.rows[0].uuid}`))).toEqual([c.mine]);
    expect(
      new Set(ids(await list(agent.token, `?channelIds=${ch.id},${ch2.id}&status=all`))),
    ).toEqual(new Set(ids(await list(agent.token, '?status=all'))));
    expect(ids(await list(agent.token, `?channelIds=${ch2.id}`))).toEqual([c.other]);
    expect(
      (await list(agent.token, '?channelIds=0a5c1d92-1f64-4f9b-8a0e-0e8b6f5a77f1')).data,
    ).toEqual([]);
    // Oldest activity first is the exact reverse of the default order when nothing is pinned.
    const recent = ids(await list(agent.token));
    expect(ids(await list(agent.token, '?sort=old'))).toEqual([...recent].reverse());
    const page1 = await list(agent.token, '?sort=old&limit=2');
    const page2 = await list(agent.token, `?sort=old&limit=2&cursor=${page1.page.nextCursor}`);
    expect([...ids(page1), ...ids(page2)]).toEqual([...recent].reverse().slice(0, 4));
    // Everything was seeded today: today is in range, a day in the past is not.
    const today = new Date().toISOString().slice(0, 10);
    expect(ids(await list(agent.token, `?from=${today}&to=${today}`))).toHaveLength(5);
    expect(ids(await list(agent.token, '?to=2000-01-01'))).toEqual([]);
    expect((await api.as(agent.token).get('/v2/inbox/conversations?from=yesterday')).status).toBe(
      422,
    );
  });

  it('the archive view shows every archived thread whatever the tab or status, and archived ones stay out of the other views', async () => {
    const a = await list(agent.token, '?archived=true&tab=mine&status=open');
    expect(ids(a)).toEqual([c.archived]);
    expect(a.data[0]!.archived).toBe(true);
    expect(ids(await list(agent.token, '?archived=false'))).not.toContain(c.archived);
    expect(ids(await list(agent.token, '?status=all'))).not.toContain(c.archived);
  });

  it('meta.counts and GET /counts equal what the tabs list, and the archived count is separate', async () => {
    const p = await list(agent.token);
    expect(p.meta.counts).toEqual({ all: 5, mine: 1, unassigned: 3, unread: 1, archived: 1 });
    const res = await api.as(agent.token).get('/v2/inbox/counts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(p.meta.counts);
    for (const tab of ['mine', 'unassigned', 'unread'] as const) {
      expect((await list(agent.token, `?tab=${tab}`)).data.length).toBe(p.meta.counts[tab]);
    }
    // Narrowed by channel, the badges follow.
    const second = await list(agent.token, `?channelId=${ch2.id}`);
    expect(second.meta.counts).toEqual({ all: 1, mine: 0, unassigned: 0, unread: 0, archived: 0 });
  });

  it('a limit above the maximum is a validation error, and limit 2 pages the whole set without repeats or gaps', async () => {
    expect((await api.as(agent.token).get('/v2/inbox/conversations?limit=500')).status).toBe(422);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const p: Page = await list(agent.token, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...ids(p));
      if (!p.page.hasMore) break;
      cursor = p.page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('refuses a malformed cursor with a validation error, never a 500', async () => {
    const res = await api.as(agent.token).get('/v2/inbox/conversations?cursor=garbage');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('list: pinned first, ties, and a cursor that survives microsecond ties', () => {
  let t: Tenant;
  let token: string;
  let ch: { id: string };
  let pinnedOld: string;
  const tied: string[] = [];

  beforeAll(async () => {
    t = await api.signup('ibp');
    token = t.admin;
    ch = await inbox.channel(t.admin);
    pinnedOld = (
      await inbox.conversation(t, ch.id, {
        pinned: true,
        lastMessageAt: '2020-01-01T00:00:00.000001Z',
      })
    ).uuid;
    // Twelve threads whose latest message has exactly the same instant: only the id breaks the tie.
    for (let i = 0; i < 12; i += 1) {
      tied.push(
        (await inbox.conversation(t, ch.id, { lastMessageAt: '2026-09-01T12:00:00.123456Z' })).uuid,
      );
    }
  });

  it('puts the pinned thread above newer unpinned ones even when its last message is years older', async () => {
    const p = await list(token, '?limit=50');
    expect(p.data[0]!.id).toBe(pinnedOld);
    expect(p.data[0]!.pinned).toBe(true);
    expect(p.data).toHaveLength(13);
  });

  it('pages through ties and the pinned boundary with no repeat and no gap, at every page size', async () => {
    for (const limit of [1, 2, 5, 7, 12]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 20; i += 1) {
        const p: Page = await list(token, `?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`);
        seen.push(...ids(p));
        if (!p.page.hasMore) break;
        cursor = p.page.nextCursor;
      }
      expect(seen, `limit ${limit}`).toHaveLength(13);
      expect(new Set(seen).size, `limit ${limit}`).toBe(13);
      expect(seen[0]).toBe(pinnedOld);
      expect(new Set(seen)).toEqual(new Set([pinnedOld, ...tied]));
    }
  });
});

describe('list: search by name, number, last message and contact', () => {
  let t: Tenant;
  let token: string;
  let ch: { id: string };
  const c: Record<string, string> = {};

  beforeAll(async () => {
    t = await api.signup('ibq');
    token = t.admin;
    ch = await inbox.channel(t.admin);
    const [contactId] = await api.seedContacts(t, [{ name: 'Renamed Rita' }]);
    const contactInternal = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contactId])).rows[0].id,
    );
    c.acme = (
      await inbox.conversation(t, ch.id, { title: 'Acme Corp', peer: '919876543210' })
    ).uuid;
    c.rita = (
      await inbox.conversation(t, ch.id, {
        title: '919000000001',
        peer: '919000000001',
        contactId: contactInternal,
      })
    ).uuid;
    c.invoice = (
      await inbox.conversation(t, ch.id, { title: 'Bob', preview: 'Where is my invoice 50% off?' })
    ).uuid;
    c.named = (await inbox.conversation(t, ch.id, { title: 'Zed', peerName: 'Zoltan Wolf' })).uuid;
  });

  const find = async (q: string) => ids(await list(token, `?q=${encodeURIComponent(q)}`));

  it('finds by the name on the thread, case-insensitively and by part', async () => {
    expect(await find('acme')).toEqual([c.acme]);
    expect(await find('CORP')).toEqual([c.acme]);
    expect(await find('zoltan')).toEqual([c.named]);
  });

  it('finds by number however it is typed: with a plus, spaces and dashes', async () => {
    expect(await find('+91 98765-43210')).toEqual([c.acme]);
    expect(await find('9876543210')).toEqual([c.acme]);
  });

  it('finds by a word of the last message, and treats a percent sign as a character', async () => {
    expect(await find('invoice')).toEqual([c.invoice]);
    expect(await find('50%')).toEqual([c.invoice]);
    expect(await find('%')).toEqual([c.invoice]);
    expect(await find('_')).toEqual([]);
  });

  it('finds by the contact name even when the thread title is only the number', async () => {
    expect(await find('rita')).toEqual([c.rita]);
    const row = (await list(token, '?q=rita')).data[0]!;
    // The list shows the contact's name, not the stale title the thread was created with.
    expect(row.title).toBe('Renamed Rita');
  });

  it('nothing matches: an empty page; an empty search is a validation error', async () => {
    expect(await find('no such customer')).toEqual([]);
    expect((await api.as(token).get('/v2/inbox/conversations?q=')).status).toBe(422);
  });
});

describe('scope: all, team and own see the same conversations in the list, the counts and by id', () => {
  let t: Tenant;
  let ch: { id: string };
  let team: number;
  let teamUuid: string;
  let otherTeam: number;
  let all: { token: string; userId: number };
  let teamer: { token: string; userId: number };
  let own: { token: string; userId: number };
  let none: { token: string; userId: number };
  const c: Record<string, string> = {};

  beforeAll(async () => {
    t = await api.signup('ibs');
    ch = await inbox.channel(t.admin);
    all = await api.member(t, 'all', [['inbox.conversation.read', 'all']]);
    teamer = await api.member(t, 'teamer', [['inbox.conversation.read', 'team']]);
    own = await api.member(t, 'own', [['inbox.conversation.read', 'own']]);
    none = await api.member(t, 'none', []);
    const mk = async (name: string) =>
      (
        await h.owner.query(`INSERT INTO teams (org_id, name) VALUES ($1,$2) RETURNING id, uuid`, [
          t.orgId,
          name,
        ])
      ).rows[0];
    const a = await mk('Sales');
    const b = await mk('Support');
    team = Number(a.id);
    teamUuid = a.uuid as string;
    otherTeam = Number(b.id);
    await h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      team,
      teamer.userId,
    ]);
    c.unassigned = (await inbox.conversation(t, ch.id, {})).uuid;
    c.toTeamer = (await inbox.conversation(t, ch.id, { assigneeUserId: teamer.userId })).uuid;
    c.toOwn = (await inbox.conversation(t, ch.id, { assigneeUserId: own.userId })).uuid;
    c.toMyTeam = (await inbox.conversation(t, ch.id, { assigneeTeamId: team })).uuid;
    c.toOtherTeam = (await inbox.conversation(t, ch.id, { assigneeTeamId: otherTeam })).uuid;
    c.toAdmin = (await inbox.conversation(t, ch.id, { assigneeUserId: t.adminUserId })).uuid;
  });

  const visible = async (token: string) => new Set(ids(await list(token, '?limit=100')));
  const get = (token: string, uuid: string) => api.as(token).get(`/v2/inbox/conversations/${uuid}`);

  it('scope all sees every conversation', async () => {
    expect((await visible(all.token)).size).toBe(6);
  });

  it('scope team sees its own, its teams and the unassigned, and not the rest', async () => {
    expect(await visible(teamer.token)).toEqual(new Set([c.unassigned, c.toTeamer, c.toMyTeam]));
  });

  it('scope own sees only what is assigned to them', async () => {
    expect(await visible(own.token)).toEqual(new Set([c.toOwn]));
  });

  it('without the permission the route is refused outright', async () => {
    expect((await api.as(none.token).get('/v2/inbox/conversations')).status).toBe(403);
    expect((await api.as(none.token).get('/v2/inbox/counts')).status).toBe(403);
    expect((await get(none.token, c.unassigned)).status).toBe(403);
  });

  it('a conversation outside the scope is a 404 by id, never a 403, exactly like one that does not exist', async () => {
    const hidden = await get(own.token, c.toTeamer);
    expect(hidden.status).toBe(404);
    expect(hidden.body.code).toBe('CONVERSATION_NOT_FOUND');
    const missing = await get(own.token, '0a5c1d92-1f64-4f9b-8a0e-0e8b6f5a77f1');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe(hidden.body.code);
    expect(missing.body.detail ?? missing.body.title).toBe(hidden.body.detail ?? hidden.body.title);
    expect((await get(teamer.token, c.toOtherTeam)).status).toBe(404);
    expect((await get(teamer.token, c.toMyTeam)).status).toBe(200);
  });

  it('the counts are over the same set the list returns, so a badge never promises what the list hides', async () => {
    for (const who of [all, teamer, own]) {
      const p = await list(who.token, '?limit=100');
      expect(p.meta.counts.all).toBe(p.data.length);
    }
    expect((await list(own.token)).meta.counts.mine).toBe(1);
    expect((await list(teamer.token)).meta.counts.unassigned).toBe(2);
    expect(teamUuid).toMatch(uuidRe);
  });

  it('every sub-route of a hidden conversation is a 404 too', async () => {
    const id = c.toTeamer;
    const as = api.as(own.token);
    const calls = [
      as.get(`/v2/inbox/conversations/${id}/messages`),
      as.get(`/v2/inbox/conversations/${id}/notes`),
      as.get(`/v2/inbox/conversations/${id}/events`),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(404);
  });
});

describe('the conversation header', () => {
  let t: Tenant;
  let ch: { id: string };
  let agent: { token: string; userId: number };
  let conv: { uuid: string; id: number };
  let other: { uuid: string };
  let contactUuid: string;

  beforeAll(async () => {
    t = await api.signup('ibd');
    agent = await api.member(t, 'agent', AGENT);
    ch = await inbox.channel(t.admin, { name: 'Main' });
    [contactUuid] = (await api.seedContacts(t, [
      { name: 'Priya Shah', email: 'priya@example.test', phone: '+919811111111' },
    ])) as [string];
    const cid = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contactUuid])).rows[0].id,
    );
    conv = await inbox.conversation(t, ch.id, {
      contactId: cid,
      assigneeUserId: agent.userId,
      messages: 3,
      unread: 2,
      lastInboundAt: new Date().toISOString(),
    });
    // The same person on another thread (an older one), which the panel lists as history.
    const ch2 = await inbox.channel(t.admin, { name: 'Second' });
    other = await inbox.conversation(t, ch2.id, { contactId: cid, preview: 'earlier chat' });
  });

  it('returns the header: channel, assignee, unread, version, capabilities, an open window and the linked contact', async () => {
    const res = await api.as(t.admin).get(`/v2/inbox/conversations/${conv.uuid}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = res.body;
    expect(d.id).toBe(conv.uuid);
    expect(d.channel.name).toBe('Main');
    expect(d.assignment.user.id).toMatch(uuidRe);
    expect(d.assignment.team).toBeNull();
    expect(d.unreadCount).toBe(2);
    expect(d.lastSeq).toBe(3);
    expect(d.capabilities.windowHours).toBe(24);
    expect(d.window.open).toBe(true);
    expect(new Date(d.window.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(d.contact.id).toBe(contactUuid);
    expect(d.contactSummary).toMatchObject({
      id: contactUuid,
      name: 'Priya Shah',
      email: 'priya@example.test',
      phone: '+919811111111',
    });
    expect(d.pastConversations.map((p: { id: string }) => p.id)).toEqual([other.uuid]);
    // No internal id leaks anywhere in the payload.
    expect(JSON.stringify(d)).not.toMatch(/"id":\d+/);
  });

  it('carries the contact lead score, who set it and why, so the side panel can show it (empty until the contact is scored)', async () => {
    const unscored = await api.as(t.admin).get(`/v2/inbox/conversations/${conv.uuid}`);
    expect(unscored.body.contactSummary).toMatchObject({
      leadScore: null,
      leadScoreSource: null,
      leadScoreReasons: null,
      leadScoredAt: null,
      leadScoreModel: null,
    });
    await h.owner.query(
      `UPDATE contacts SET lead_score = 81, lead_score_source = 'ai', lead_score_reasons = '["Asked about price"]'::jsonb,
         lead_scored_at = now(), lead_score_model = 'openai/gpt-6-luna-pro' WHERE uuid = $1`,
      [contactUuid],
    );
    const scored = await api.as(t.admin).get(`/v2/inbox/conversations/${conv.uuid}`);
    expect(scored.body.contactSummary).toMatchObject({
      leadScore: 81,
      leadScoreSource: 'ai',
      leadScoreReasons: ['Asked about price'],
      leadScoreModel: 'openai/gpt-6-luna-pro',
    });
    expect(new Date(scored.body.contactSummary.leadScoredAt).getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
  });

  it('a caller who may not read contacts (an agent without that right) gets the conversation without the contact summary', async () => {
    const res = await api.as(agent.token).get(`/v2/inbox/conversations/${conv.uuid}`);
    expect(res.status).toBe(200);
    expect(res.body.contactSummary).toBeNull();
    expect(res.body.contact.id).toBe(contactUuid);
  });

  it('shows a closed window and when it closed, for a customer who last wrote two days ago', async () => {
    const old = await inbox.conversation(t, ch.id, {
      lastInboundAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
    });
    const res = await api.as(agent.token).get(`/v2/inbox/conversations/${old.uuid}`);
    expect(res.body.window.open).toBe(false);
    expect(new Date(res.body.window.expiresAt).getTime()).toBeLessThan(Date.now());
  });

  it('does not list past conversations the caller may not see', async () => {
    const own = await api.member(t, 'ownonly', [['inbox.conversation.read', 'own']]);
    await h.owner.query(`UPDATE conversations SET assignee_user_id = $1 WHERE uuid = $2`, [
      own.userId,
      conv.uuid,
    ]);
    const res = await api.as(own.token).get(`/v2/inbox/conversations/${conv.uuid}`);
    expect(res.status).toBe(200);
    expect(res.body.pastConversations).toEqual([]);
  });
});

describe("cross-tenant: another workspace's conversation is a 404 on every route", () => {
  let a: Tenant;
  let b: Tenant;
  let victim: { uuid: string; id: number };
  let message: { uuid: string };

  beforeAll(async () => {
    a = await api.signup('ixa');
    b = await api.signup('ixb');
    const ch = await inbox.channel(a.admin);
    victim = await inbox.conversation(a, ch.id, { messages: 2 });
    message = await inbox.message(a, victim.id, 3, { direction: 'out', status: 'failed' });
    await h.owner.query(`UPDATE conversations SET msg_seq = 3 WHERE id = $1`, [victim.id]);
  });

  it.each([
    ['GET', (id: string) => `/v2/inbox/conversations/${id}`],
    ['GET', (id: string) => `/v2/inbox/conversations/${id}/messages`],
    ['GET', (id: string) => `/v2/inbox/conversations/${id}/notes`],
    ['GET', (id: string) => `/v2/inbox/conversations/${id}/events`],
    ['POST', (id: string) => `/v2/inbox/conversations/${id}/read`],
    ['POST', (id: string) => `/v2/inbox/conversations/${id}/status`],
    ['POST', (id: string) => `/v2/inbox/conversations/${id}/assign`],
    ['POST', (id: string) => `/v2/inbox/conversations/${id}/notes`],
    ['POST', (id: string) => `/v2/inbox/conversations/${id}/messages`],
  ])('%s %#', async (method, path) => {
    const client = api.as(b.admin);
    const url = path(victim.uuid);
    const bodies: Record<string, unknown> = {
      read: { upToSeq: 1 },
      status: { rowVersion: 1, status: 'resolved' },
      assign: { rowVersion: 1, userId: null },
      notes: { body: 'x' },
      messages: {
        kind: 'text',
        body: 'hi',
        clientMessageId: '6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e10',
      },
    };
    const key = url.split('/').pop()!;
    const res =
      method === 'GET' ? await client.get(url) : await client.post(url).send(bodies[key] ?? {});
    expect(res.status, `${method} ${url}: ${JSON.stringify(res.body)}`).toBe(404);
  });

  it("retrying another workspace's message is a 404, and deleting its note too", async () => {
    const res = await api.as(b.admin).post(`/v2/inbox/messages/${message.uuid}/retry`);
    expect(res.status).toBe(404);
    const del = await api
      .as(b.admin)
      .delete(`/v2/inbox/conversations/${victim.uuid}/notes/0a5c1d92-1f64-4f9b-8a0e-0e8b6f5a77f1`);
    expect(del.status).toBe(404);
  });

  it('the list of the other workspace never contains it', async () => {
    const p = await list(b.admin, '?status=all&limit=100');
    expect(ids(p)).not.toContain(victim.uuid);
    expect(p.meta.counts.all).toBe(0);
  });
});
