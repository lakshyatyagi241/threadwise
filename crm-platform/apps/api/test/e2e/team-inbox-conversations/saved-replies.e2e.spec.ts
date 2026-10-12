import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT, Api, Inbox, startHarness, type Harness, type Tenant } from './support';

/**
 * Saved replies (TW-TIB1-024): the library API (permissions, plan limit, validation, shortcuts, visibility of shared and personal
 * replies, idempotency, audit and outbox) and the `use` endpoint that fills a reply in for a real conversation, contact, agent and channel.
 * Real Postgres through the restricted application role; each block works in an organization of its own.
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

interface Reply {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  scope: 'shared' | 'mine';
  usedCount: number;
  canEdit: boolean;
  rowVersion: number;
  [k: string]: unknown;
}

const repliesApi = (token: string) => ({
  list: (qs = '') => api.as(token).get(`/v2/inbox/saved-replies${qs}`),
  get: (id: string) => api.as(token).get(`/v2/inbox/saved-replies/${id}`),
  create: (body: Record<string, unknown>, key: string = randomUUID()) =>
    api.as(token).post('/v2/inbox/saved-replies').set('idempotency-key', key).send(body),
  update: (id: string, body: Record<string, unknown>) =>
    api
      .as(token)
      .patch(`/v2/inbox/saved-replies/${id}`)
      .set('idempotency-key', randomUUID())
      .send(body),
  remove: (id: string) =>
    api.as(token).delete(`/v2/inbox/saved-replies/${id}`).set('idempotency-key', randomUUID()),
  duplicate: (id: string) =>
    api
      .as(token)
      .post(`/v2/inbox/saved-replies/${id}/duplicate`)
      .set('idempotency-key', randomUUID()),
  use: (id: string, conversationId: string) =>
    api
      .as(token)
      .post(`/v2/inbox/saved-replies/${id}/use`)
      .set('idempotency-key', randomUUID())
      .send({ conversationId }),
});

const row = async (id: string) =>
  (await h.owner.query(`SELECT * FROM saved_replies WHERE uuid = $1`, [id])).rows[0] as Record<
    string,
    unknown
  >;
const shortcuts = (res: { body: { data: Reply[] } }) => res.body.data.map((r) => r.shortcut);

const MANAGER: Array<[string, 'all']> = [
  ['inbox.savedreply.manage', 'all'],
  ['inbox.conversation.read', 'all'],
  ['inbox.conversation.reply', 'all'],
];

describe('the library API', () => {
  let t: Tenant;
  let other: Tenant;
  let manager: { token: string; userId: number };
  let manager2: { token: string; userId: number };
  let agent: { token: string; userId: number };
  let nobody: { token: string; userId: number };

  beforeAll(async () => {
    t = await api.signup('sra');
    other = await api.signup('srb');
    manager = await api.member(t, 'srmanager', MANAGER);
    manager2 = await api.member(t, 'srmanager2', MANAGER);
    agent = await api.member(t, 'sragent', AGENT);
    nobody = await api.member(t, 'srnobody', [['record.contacts.read', 'all']]);
  });

  const body = (over: Record<string, unknown> = {}) => ({
    shortcut: 'Thank You',
    title: 'Thanks',
    body: 'Thanks for writing in, {{first_name}}!',
    ...over,
  });

  it('creating needs inbox.savedreply.manage; reading needs the right to reply or to manage', async () => {
    expect((await repliesApi(nobody.token).list()).status).toBe(403);
    expect((await repliesApi(nobody.token).create(body())).status).toBe(403);
    expect((await repliesApi(agent.token).create(body())).status).toBe(403);
    // not even a personal reply: Reference gates every create on the manage right
    expect((await repliesApi(agent.token).create(body({ scope: 'mine' }))).status).toBe(403);

    const res = await repliesApi(manager.token).create(body());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      shortcut: 'thank_you',
      title: 'Thanks',
      scope: 'shared',
      usedCount: 0,
      lastUsedAt: null,
      canEdit: true,
      channelKinds: [],
      category: null,
      createdByName: 'srmanager',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/"(org_?id|user_?id)"/i);
    expect(await api.auditCount(t.orgId, 'saved_replies', 'insert')).toBeGreaterThan(0);
    const events = await api.events(t.orgId, 'inbox.saved_reply.created');
    expect(events[events.length - 1]).toMatchObject({ shortcut: 'thank_you', scope: 'shared' });

    // an agent can read and insert it, and is told they cannot change it
    const seen = await repliesApi(agent.token).list();
    expect(seen.status).toBe(200);
    expect(seen.body.data[0]).toMatchObject({ shortcut: 'thank_you', canEdit: false });
    // a manager without the inbox right can still open the settings list
    const onlyManage = await api.member(t, 'sronlymanage', [['inbox.savedreply.manage', 'all']]);
    expect((await repliesApi(onlyManage.token).list()).status).toBe(200);
  });

  it('a retried create with the same Idempotency-Key makes one reply', async () => {
    const key = randomUUID();
    const first = await repliesApi(manager.token).create(body({ shortcut: 'once' }), key);
    const second = await repliesApi(manager.token).create(body({ shortcut: 'once' }), key);
    expect(second.status).toBe(first.status);
    expect(second.body.id).toBe(first.body.id);
    const n = await h.owner.query(
      `SELECT count(*)::int AS n FROM saved_replies WHERE org_id = $1 AND shortcut = 'once'`,
      [t.orgId],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it('validates the body: shortcut, lengths, unknown fields; markup is kept as text', async () => {
    for (const bad of [
      body({ shortcut: '///' }),
      body({ title: '' }),
      body({ body: 'x'.repeat(4001) }),
      body({ scope: 'team' }),
      body({ channelKinds: ['pigeon'] }),
      body({ userId: 1 }),
    ]) {
      const res = await repliesApi(manager.token).create(bad);
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    const html = await repliesApi(manager.token).create(
      body({ shortcut: 'markup', body: '*bold* <img src=x onerror=alert(1)> <script>1</script>' }),
    );
    expect(html.status).toBe(201);
    expect(html.body.body).toBe('*bold* <img src=x onerror=alert(1)> <script>1</script>');
    expect(html.headers['content-type']).toMatch(/json/);
    expect((await row(html.body.id)).body).toBe(html.body.body);
  });

  it('a shortcut is unique per owner: 409 for a second shared one, but a personal reply may reuse it', async () => {
    const a = await repliesApi(manager.token).create(body({ shortcut: 'dupe' }));
    expect(a.status).toBe(201);
    const b = await repliesApi(manager.token).create(body({ shortcut: 'DUPE' }));
    expect(b.status).toBe(409);
    expect(b.body.code).toBe('SAVED_REPLY_SHORTCUT_TAKEN');
    const mine = await repliesApi(manager.token).create(body({ shortcut: 'dupe', scope: 'mine' }));
    expect(mine.status).toBe(201);
    expect(mine.body.scope).toBe('mine');
    expect(
      (await repliesApi(manager.token).create(body({ shortcut: 'dupe', scope: 'mine' }))).status,
    ).toBe(409);
    // somebody else's personal reply does not collide with mine
    expect(
      (await repliesApi(manager2.token).create(body({ shortcut: 'dupe', scope: 'mine' }))).status,
    ).toBe(201);
  });

  it("shared replies are everyone's, personal ones only their owner's (a colleague gets a 404, even a manager)", async () => {
    const mine = await repliesApi(manager.token).create(
      body({ shortcut: 'private_one', scope: 'mine' }),
    );
    const id = mine.body.id as string;
    const list = await repliesApi(manager2.token).list('?q=private_one');
    expect(list.body.data).toEqual([]);
    expect((await repliesApi(manager2.token).get(id)).status).toBe(404);
    expect(
      (await repliesApi(manager2.token).update(id, { rowVersion: 1, title: 'x' })).status,
    ).toBe(404);
    expect((await repliesApi(manager2.token).remove(id)).status).toBe(404);
    expect((await repliesApi(agent.token).get(id)).status).toBe(404);
    const ownList = await repliesApi(manager.token).list('?scope=mine');
    expect(shortcuts(ownList)).toContain('private_one');
    expect(ownList.body.data.every((r: Reply) => r.scope === 'mine')).toBe(true);
    const shared = await repliesApi(manager.token).list('?scope=shared');
    expect(shared.body.data.every((r: Reply) => r.scope === 'shared')).toBe(true);
    expect(shortcuts(shared)).not.toContain('private_one');
    // the tab counts, and the plan total (the plan counts every reply of the workspace)
    expect(ownList.body.counts.mine).toBeGreaterThan(0);
    const other2 = await repliesApi(manager2.token).list();
    expect(other2.body.total).toBeGreaterThan(other2.body.counts.all);
  });

  it("editing: a shared reply needs the manage right, a personal one is its owner's; a stale version is a 409", async () => {
    const created = (await repliesApi(manager.token).create(body({ shortcut: 'edit_me' })))
      .body as Reply;
    const refused = await repliesApi(agent.token).update(created.id, {
      rowVersion: created.rowVersion,
      title: 'hijack',
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('SAVED_REPLY_NOT_EDITABLE');
    expect((await repliesApi(agent.token).remove(created.id)).status).toBe(403);

    const updated = await repliesApi(manager2.token).update(created.id, {
      rowVersion: created.rowVersion,
      title: 'Edited title',
      shortcut: '/Edited Shortcut',
      category: 'Billing',
      language: 'en',
      channelKinds: ['whatsapp_cloud'],
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body).toMatchObject({
      title: 'Edited title',
      shortcut: 'edited_shortcut',
      category: 'Billing',
      language: 'en',
      channelKinds: ['whatsapp_cloud'],
      rowVersion: created.rowVersion + 1,
    });
    const stale = await repliesApi(manager.token).update(created.id, {
      rowVersion: created.rowVersion,
      title: 'late',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    // moving onto a shortcut that is taken
    const taken = await repliesApi(manager.token).update(created.id, {
      rowVersion: updated.body.rowVersion,
      shortcut: 'dupe',
    });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('SAVED_REPLY_SHORTCUT_TAKEN');
    expect(await api.auditCount(t.orgId, 'saved_replies', 'update')).toBeGreaterThan(0);
    expect((await api.events(t.orgId, 'inbox.saved_reply.updated')).length).toBeGreaterThan(0);

    // the scope cannot be changed afterwards
    const scoped = await repliesApi(manager.token).update(created.id, {
      rowVersion: updated.body.rowVersion,
      scope: 'mine',
    });
    expect(scoped.status).toBe(422);
  });

  it('a personal reply is edited and deleted by its owner even without the manage right', async () => {
    const personal = (
      await repliesApi(manager.token).create(body({ shortcut: 'own_edit', scope: 'mine' }))
    ).body as Reply;
    // the owner loses the manage right but keeps the right to reply
    const reduced = await api.member(t, 'srreduced', AGENT);
    await h.owner.query(`UPDATE saved_replies SET user_id = $1 WHERE uuid = $2`, [
      reduced.userId,
      personal.id,
    ]);
    const edited = await repliesApi(reduced.token).update(personal.id, {
      rowVersion: Number((await row(personal.id)).row_version),
      title: 'mine, edited',
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.canEdit).toBe(true);
    expect((await repliesApi(reduced.token).remove(personal.id)).status).toBe(204);
  });

  it('lists most used first, searches shortcut, title and body, and pages with a cursor', async () => {
    const t2 = await api.signup('src');
    const m = await api.member(t2, 'srcm', [
      ['inbox.savedreply.manage', 'all'],
      ['inbox.conversation.reply', 'all'],
    ]);
    const make = async (shortcut: string, title: string, text: string, extra = {}) =>
      (await repliesApi(m.token).create({ shortcut, title, body: text, ...extra })).body as Reply;
    await make('alpha', 'Greeting', 'Hello there');
    const b = await make('beta', 'Refunds', 'We refund within 5 days (50% off shipping)', {
      category: 'Billing',
    });
    const c = await make('gamma', 'Shipping', 'It ships tomorrow', { channelKinds: ['email'] });
    await h.owner.query(`UPDATE saved_replies SET used_count = 5 WHERE uuid = $1`, [c.id]);
    await h.owner.query(`UPDATE saved_replies SET used_count = 2 WHERE uuid = $1`, [b.id]);

    const all = await repliesApi(m.token).list();
    expect(shortcuts(all)).toEqual(['gamma', 'beta', 'alpha']);
    expect(all.body.counts).toEqual({ all: 3, shared: 3, mine: 0 });
    expect(all.body.categories).toEqual(['Billing']);

    const p1 = (await repliesApi(m.token).list('?limit=2')).body;
    expect(p1.data.map((r: Reply) => r.shortcut)).toEqual(['gamma', 'beta']);
    expect(p1.page.hasMore).toBe(true);
    const p2 = (await repliesApi(m.token).list(`?limit=2&cursor=${p1.page.nextCursor}`)).body;
    expect(p2.data.map((r: Reply) => r.shortcut)).toEqual(['alpha']);
    expect(p2.page.hasMore).toBe(false);

    expect(shortcuts(await repliesApi(m.token).list('?q=%2Fbet'))).toEqual(['beta']); // "/bet"
    expect(shortcuts(await repliesApi(m.token).list('?q=shipping'))).toEqual(['gamma', 'beta']);
    expect(shortcuts(await repliesApi(m.token).list('?q=50%25'))).toEqual(['beta']);
    expect(shortcuts(await repliesApi(m.token).list('?q=%25'))).toEqual(['beta']); // % is text, not a wildcard
    expect(shortcuts(await repliesApi(m.token).list('?category=billing'))).toEqual(['beta']);
    // a reply restricted to email is left out for a WhatsApp conversation
    expect(shortcuts(await repliesApi(m.token).list('?channelKind=whatsapp_cloud'))).toEqual([
      'beta',
      'alpha',
    ]);
    expect(shortcuts(await repliesApi(m.token).list('?channelKind=email'))).toEqual([
      'gamma',
      'beta',
      'alpha',
    ]);
    expect((await repliesApi(m.token).list('?limit=500')).status).toBe(422);
  });

  it('duplicate copies the reply (same scope), finds a free shortcut and needs the manage right', async () => {
    const src = (
      await repliesApi(manager.token).create(
        body({ shortcut: 'copy_src', channelKinds: ['email'] }),
      )
    ).body as Reply;
    const c1 = await repliesApi(manager.token).duplicate(src.id);
    expect(c1.status, JSON.stringify(c1.body)).toBe(201);
    expect(c1.body).toMatchObject({
      shortcut: 'copy_src_2',
      title: 'Thanks (copy)',
      scope: 'shared',
      usedCount: 0,
      channelKinds: ['email'],
    });
    const c2 = await repliesApi(manager.token).duplicate(src.id);
    expect(c2.body.shortcut).toBe('copy_src_3');
    expect((await repliesApi(agent.token).duplicate(src.id)).status).toBe(403);
  });

  it('delete removes the reply (204, then 404) with its audit row and event', async () => {
    const r = (await repliesApi(manager.token).create(body({ shortcut: 'to_delete' })))
      .body as Reply;
    expect((await repliesApi(manager.token).remove(r.id)).status).toBe(204);
    expect((await repliesApi(manager.token).remove(r.id)).status).toBe(404);
    expect((await repliesApi(manager.token).get(r.id)).status).toBe(404);
    expect(await api.auditCount(t.orgId, 'saved_replies', 'delete')).toBeGreaterThan(0);
    const events = await api.events(t.orgId, 'inbox.saved_reply.deleted');
    expect(events[events.length - 1]).toMatchObject({ shortcut: 'to_delete' });
  });

  it('the plan limit counts every reply of the workspace and refuses the next one with 422', async () => {
    const t3 = await api.signup('srd');
    const m = await api.member(t3, 'srdm', [
      ['inbox.savedreply.manage', 'all'],
      ['inbox.conversation.reply', 'all'],
    ]);
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
      [t3.orgId, JSON.stringify({ limits: { saved_replies: 2 } })],
    );
    const mk = (s: string, scope = 'shared') =>
      repliesApi(m.token).create(body({ shortcut: s, scope }));
    expect((await mk('one')).status).toBe(201);
    expect((await mk('two', 'mine')).status).toBe(201);
    const over = await mk('three');
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(JSON.stringify(over.body)).toContain('upgradeUrl');
    expect(JSON.stringify(over.body)).toContain('saved_replies');
    const list = await repliesApi(m.token).list();
    expect(list.body).toMatchObject({ total: 2, limit: 2 });
    const first = list.body.data.find((r: Reply) => r.shortcut === 'one') as Reply;
    expect((await repliesApi(m.token).duplicate(first.id)).status).toBe(422);
    // deleting frees a slot
    expect((await repliesApi(m.token).remove(first.id)).status).toBe(204);
    expect((await mk('three')).status).toBe(201);
    // no override and a plan without a cap: unlimited, and the meter says so
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"saved_replies":0}}'::jsonb WHERE org_id = $1`,
      [t3.orgId],
    );
    expect((await mk('four')).status).toBe(201);
    expect((await repliesApi(m.token).list()).body.limit).toBeNull();
  });

  it("tenants never see or touch each other's replies", async () => {
    const mine = (await repliesApi(manager.token).list()).body.data as Reply[];
    expect(mine.length).toBeGreaterThan(0);
    const theirs = await repliesApi(other.admin).list();
    expect(theirs.body.data).toEqual([]);
    expect((await repliesApi(other.admin).get(mine[0]!.id)).status).toBe(404);
    expect(
      (
        await repliesApi(other.admin).update(mine[0]!.id, {
          rowVersion: mine[0]!.rowVersion,
          title: 'x',
        })
      ).status,
    ).toBe(404);
    expect((await repliesApi(other.admin).remove(mine[0]!.id)).status).toBe(404);
    // the same shortcut in another workspace is its own reply
    expect((await repliesApi(other.admin).create(body({ shortcut: 'thank_you' }))).status).toBe(
      201,
    );
  });
});

describe('use: fill a reply in for a conversation', () => {
  let t: Tenant;
  let other: Tenant;
  let ch: { id: string };
  let manager: { token: string; userId: number };
  let agent: { token: string; userId: number };
  let ownScope: { token: string; userId: number };
  let noReply: { token: string; userId: number };
  let conv: { uuid: string; id: number };
  let bare: { uuid: string; id: number };

  beforeAll(async () => {
    t = await api.signup('sru');
    other = await api.signup('srv');
    ch = await inbox.channel(t.admin);
    const channelRow = await inbox.channelId(ch.id);
    await h.owner.query(
      `UPDATE channels SET name = 'Sales line', display_address = '+971 4 000 0000' WHERE id = $1`,
      [channelRow],
    );
    manager = await api.member(t, 'sumanager', MANAGER);
    agent = await api.member(t, 'samrivera', AGENT);
    ownScope = await api.member(t, 'suown', [
      ['inbox.conversation.read', 'own'],
      ['inbox.conversation.reply', 'own'],
    ]);
    noReply = await api.member(t, 'sunoreply', [['inbox.conversation.read', 'all']]);
    const [contactId] = await api.seedContacts(t, [
      {
        name: 'Amira Khan',
        phone: '+971500000001',
        email: 'amira@example.test',
        data: { city: 'Dubai' },
      },
    ]);
    await h.owner.query(
      `UPDATE contacts SET first_name = 'Amira', last_name = 'Khan' WHERE uuid = $1`,
      [contactId],
    );
    const contactInternal = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contactId])).rows[0].id,
    );
    conv = await inbox.conversation(t, ch.id, { contactId: contactInternal });
    bare = await inbox.conversation(t, ch.id, { peerName: 'Omar Ali' });
  });

  const make = async (text: string, extra: Record<string, unknown> = {}) =>
    (
      await repliesApi(manager.token).create({
        shortcut: `u${Math.random().toString(36).slice(2, 8)}`,
        title: 'Use',
        body: text,
        ...extra,
      })
    ).body as Reply;

  it('fills contact, agent, workspace and channel variables and counts the use, sending nothing', async () => {
    const r = await make(
      'Hi {{first_name}} {{contact.last_name}} from {{city}}, it is {{agent.first_name}} at {{workspace_name}} ({{device_name}}, {{device_phone}}).',
    );
    const res = await repliesApi(agent.token).use(r.id, conv.uuid);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      id: r.id,
      text: expect.stringMatching(
        /^Hi Amira Khan from Dubai, it is samrivera at .+ \(Sales line, \+971 4 000 0000\)\.$/,
      ),
      issues: [],
      usedCount: 1,
    });
    const messages = await h.owner.query(
      `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1`,
      [conv.id],
    );
    expect(messages.rows[0].n).toBe(1); // only the seeded inbound message: nothing was sent
    const stored = await row(r.id);
    expect(Number(stored.used_count)).toBe(1);
    expect(stored.last_used_at).not.toBeNull();
    // counting a use leaves the version alone, so an open edit dialog stays valid
    expect(Number(stored.row_version)).toBe(r.rowVersion);
    const again = await repliesApi(agent.token).use(r.id, conv.uuid);
    expect(again.body.usedCount).toBe(2);
    // the list is ordered by use: this one now leads
    const list = await repliesApi(agent.token).list();
    expect(list.body.data[0].id).toBe(r.id);
  });

  it('a variable that cannot be filled stays as written and is flagged, never dropped', async () => {
    const r = await make('Hello {{first_name}}, {{no_such_thing}} and {{email}} {{middle_name}}');
    const res = await repliesApi(agent.token).use(r.id, bare.uuid);
    expect(res.status).toBe(200);
    // no contact on this thread: the name the customer writes under stands in for the name
    expect(res.body.text).toBe('Hello Omar, {{no_such_thing}} and {{email}} {{middle_name}}');
    expect(res.body.issues).toEqual([
      { token: '{{no_such_thing}}', key: 'no_such_thing', reason: 'unknown' },
      { token: '{{email}}', key: 'email', reason: 'empty' },
      { token: '{{middle_name}}', key: 'middle_name', reason: 'empty' },
    ]);
  });

  it('needs the right to reply, a conversation the caller can see, and a channel the reply allows', async () => {
    const r = await make('Hi {{first_name}}');
    expect((await repliesApi(noReply.token).use(r.id, conv.uuid)).status).toBe(403);
    // a scope of "own" does not cover a conversation assigned to nobody: it is a 404, not a hint that it exists
    const hidden = await repliesApi(ownScope.token).use(r.id, conv.uuid);
    expect(hidden.status).toBe(404);
    expect(hidden.body.code).toBe('CONVERSATION_NOT_FOUND');
    expect((await repliesApi(agent.token).use(r.id, randomUUID())).status).toBe(404);
    expect((await repliesApi(other.admin).use(r.id, conv.uuid)).status).toBe(404);

    const email = await make('Only by mail', { channelKinds: ['email'] });
    const mismatch = await repliesApi(agent.token).use(email.id, conv.uuid);
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.code).toBe('SAVED_REPLY_CHANNEL_MISMATCH');
    expect(Number((await row(email.id)).used_count)).toBe(0);
    const simulator = await make('Simulator ok', { channelKinds: ['simulator'] });
    expect((await repliesApi(agent.token).use(simulator.id, conv.uuid)).status).toBe(200);
  });

  it("another person's personal reply cannot be used, and a body is treated as text", async () => {
    const personal = await make('Mine {{first_name}}', { scope: 'mine' });
    expect((await repliesApi(agent.token).use(personal.id, conv.uuid)).status).toBe(404);
    expect((await repliesApi(manager.token).use(personal.id, conv.uuid)).status).toBe(200);
    const script = await make('<script>alert({{first_name}})</script>');
    const res = await repliesApi(agent.token).use(script.id, conv.uuid);
    expect(res.body.text).toBe('<script>alert(Amira)</script>');
    expect(res.headers['content-type']).toMatch(/json/);
  });
});
