import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { pngOfSize } from '../../support/images';

/**
 * Team chat end to end through HTTP (TW-TCHAT-001..027): the access model, channels and unread counts, history and polling,
 * posting with mentions, replies and attachments, read pointers, edit / delete / pin / react / search, presence and the
 * invitation workflow, with the audit, outbox and tenant properties each write must have. One app, one database; each block
 * works in an organization of its own.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const code = (res: { body: { code?: string } }) => res.body.code;

interface Channel {
  id: string;
  name: string;
  slug: string;
  type: 'public' | 'private' | 'dm';
  description: string | null;
  unread: number;
  lastMessageAt: string | null;
  peer: { id: string; name: string } | null;
  rowVersion: number;
}
interface Message {
  id: string;
  channelId: string;
  authorId: string | null;
  authorName: string;
  body: string | null;
  mentions: string[];
  replyTo: { id: string; authorName: string; snippet: string } | null;
  attachment: { name: string; mime: string | null; url: string; isImage: boolean } | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  pinnedAt: string | null;
  editedAt: string | null;
  isMine: boolean;
  rowVersion: number;
  createdAt: string;
}
type MessagePage = {
  data: Message[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
};

const PNG = pngOfSize(8 + 64);
const PDF = Buffer.from('%PDF-1.7\n%test\n');

async function channels(token: string): Promise<{ data: Channel[]; me: Record<string, unknown> }> {
  const res = await api.as(token).get('/v2/team-chat/channels');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}
async function general(token: string): Promise<Channel> {
  return (await channels(token)).data.find((c) => c.slug === 'general')!;
}
async function createChannel(
  token: string,
  name: string,
  type: 'public' | 'private' = 'public',
): Promise<Channel> {
  const res = await api.as(token).post('/v2/team-chat/channels').send({ name, type });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Channel;
}
async function say(
  token: string,
  channel: string,
  body: string,
  extra: Record<string, unknown> = {},
) {
  const res = await api
    .as(token)
    .post(`/v2/team-chat/channels/${channel}/messages`)
    .send({ body, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Message;
}
async function history(token: string, channel: string, qs = ''): Promise<MessagePage> {
  const res = await api.as(token).get(`/v2/team-chat/channels/${channel}/messages${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}
async function userUuid(userId: number) {
  return (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0]
    .uuid as string;
}
const count = async (sql: string, params: unknown[]) =>
  Number((await h.owner.query(sql, params)).rows[0].n);

const NO_GRANTS: Grant[] = [];
const VIEWER: Grant[] = [['record.contacts.read']];

describe('TW-TCHAT-001, 002: the page seed and the access model', () => {
  let t: Tenant;
  let agent: { token: string; userId: number };
  beforeAll(async () => {
    t = await api.signup('tca');
    agent = await api.member(t, 'agent', NO_GRANTS);
  });

  it('001 #1: a workspace with no channels gets a public #general on the first visit, selected by default', async () => {
    expect(
      await count(`SELECT count(*) n FROM team_chat_channels WHERE org_id = $1`, [t.orgId]),
    ).toBe(0);
    const list = await channels(t.admin);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      name: 'general',
      slug: 'general',
      type: 'public',
      description: 'Everyone in this workspace',
    });
    expect(list.data[0]!.id).toMatch(uuidRe);
    expect(list.data[0]).not.toHaveProperty('orgId');
  });

  it('001 #2: a second visit, and a parallel first visit, create no duplicate', async () => {
    await channels(t.admin);
    await Promise.all([channels(t.admin), channels(agent.token), channels(agent.token)]);
    expect(
      await count(
        `SELECT count(*) n FROM team_chat_channels WHERE org_id = $1 AND slug = 'general'`,
        [t.orgId],
      ),
    ).toBe(1);
  });

  it('001 #3: a caller who is not a staff user (no token) is refused with 401', async () => {
    const res = await api.http().get('/v2/team-chat/channels');
    expect(res.status).toBe(401);
  });

  it('002 #1: a member without the channel-manage key cannot create a channel, and no row appears', async () => {
    const res = await api
      .as(agent.token)
      .post('/v2/team-chat/channels')
      .send({ name: 'nope', type: 'public' });
    expect(res.status).toBe(403);
    expect(code(res)).toBe('FORBIDDEN');
    expect(
      await count(`SELECT count(*) n FROM team_chat_channels WHERE org_id = $1 AND slug = 'nope'`, [
        t.orgId,
      ]),
    ).toBe(0);
  });

  it('002 #4: a member with no permissions at all can open the chat and post (no role gate)', async () => {
    const viewer = await api.member(t, 'viewer', VIEWER);
    const g = await general(viewer.token);
    const m = await say(viewer.token, g.id, 'viewer says hi');
    expect(m.body).toBe('viewer says hi');
  });

  it('002 #3: a channel of another workspace is 404, and so is its message', async () => {
    const other = await api.signup('tcb');
    const theirs = await general(other.admin);
    const theirMsg = await say(other.admin, theirs.id, 'secret');
    expect((await api.as(t.admin).get(`/v2/team-chat/channels/${theirs.id}/messages`)).status).toBe(
      404,
    );
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/team-chat/channels/${theirs.id}/messages`)
          .send({ body: 'x' })
      ).status,
    ).toBe(404);
    expect((await api.as(t.admin).delete(`/v2/team-chat/messages/${theirMsg.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/team-chat/messages/${theirMsg.id}/reactions`)
          .send({ emoji: '👍' })
      ).status,
    ).toBe(404);
    expect((await api.as(t.admin).delete(`/v2/team-chat/channels/${theirs.id}`)).status).toBe(404);
    expect(
      await count(`SELECT count(*) n FROM team_chat_messages WHERE org_id = $1`, [other.orgId]),
    ).toBe(1);
  });

  it('002 #2: what the caller may do comes back with the channel list', async () => {
    const admin = await channels(t.admin);
    expect(admin.me).toMatchObject({
      canManageChannels: true,
      canDecideInvitations: true,
      canModerate: true,
    });
    const plain = await channels(agent.token);
    expect(plain.me).toMatchObject({
      canManageChannels: false,
      canDecideInvitations: false,
      canModerate: false,
    });
  });
});

describe('TW-TCHAT-003, 004, 005, 006: channels, unread, visibility, delete', () => {
  let t: Tenant;
  let bob: { token: string; userId: number };
  beforeAll(async () => {
    t = await api.signup('tcc');
    bob = await api.member(t, 'bob', NO_GRANTS);
  });

  it('004 #1, #2: Support_Team is stored lower-case with a dash slug; support_team then collides with it', async () => {
    const ch = await createChannel(t.admin, 'Support_Team');
    expect(ch).toMatchObject({ name: 'support_team', slug: 'support-team', type: 'public' });
    const dup = await api
      .as(t.admin)
      .post('/v2/team-chat/channels')
      .send({ name: 'support_team', type: 'public' });
    expect(dup.status).toBe(422);
    expect(code(dup)).toBe('TCHAT_CHANNEL_NAME_TAKEN');
    const dup2 = await api
      .as(t.admin)
      .post('/v2/team-chat/channels')
      .send({ name: 'support-team', type: 'private' });
    expect(code(dup2)).toBe('TCHAT_CHANNEL_NAME_TAKEN');
  });

  it('004 #3, #4: a private channel has its creator as channel admin; a public one has no member rows', async () => {
    const priv = await createChannel(t.admin, 'leads', 'private');
    const row = await h.owner.query(
      `SELECT m.role FROM team_chat_channel_members m JOIN team_chat_channels c ON c.org_id = m.org_id AND c.id = m.channel_id
        WHERE c.uuid = $1 AND m.user_id = $2`,
      [priv.id, t.adminUserId],
    );
    expect(row.rows.map((r) => r.role)).toEqual(['admin']);
    const pub = await createChannel(t.admin, 'ops');
    expect(
      await count(
        `SELECT count(*) n FROM team_chat_channel_members m JOIN team_chat_channels c ON c.org_id = m.org_id AND c.id = m.channel_id WHERE c.uuid = $1`,
        [pub.id],
      ),
    ).toBe(0);
  });

  it('004 #5: -abc, has space, an over-long name and a dm type are 422', async () => {
    for (const name of ['-abc', 'has space', 'a'.repeat(65)]) {
      const res = await api
        .as(t.admin)
        .post('/v2/team-chat/channels')
        .send({ name, type: 'public' });
      expect(res.status, name).toBe(422);
    }
    const dm = await api.as(t.admin).post('/v2/team-chat/channels').send({ name: 'x', type: 'dm' });
    expect(dm.status).toBe(422);
  });

  it('004: creating a channel writes an audit row and a teamchat.channel.created event', async () => {
    const ch = await createChannel(t.admin, 'audited');
    expect(await api.auditCount(t.orgId, 'team_chat_channels', 'insert')).toBeGreaterThan(0);
    const events = await api.events(t.orgId, 'teamchat.channel.created');
    expect(events.some((e) => (e as { uuid?: string }).uuid === ch.id)).toBe(true);
  });

  it('003 #1: three messages from others are unread; reading to the newest makes it 0', async () => {
    const ch = await createChannel(t.admin, 'unread-test');
    for (const n of [1, 2, 3]) await say(t.admin, ch.id, `m${n}`);
    const before = (await channels(bob.token)).data.find((c) => c.id === ch.id)!;
    expect(before.unread).toBe(3);
    const read = await api.as(bob.token).post(`/v2/team-chat/channels/${ch.id}/read`).send({});
    expect(read.status).toBe(200);
    expect((await channels(bob.token)).data.find((c) => c.id === ch.id)!.unread).toBe(0);
  });

  it('003 #3: my own newest message does not count as unread', async () => {
    const ch = await createChannel(t.admin, 'own-test');
    await say(bob.token, ch.id, 'mine');
    expect((await channels(bob.token)).data.find((c) => c.id === ch.id)!.unread).toBe(0);
    expect((await channels(t.admin)).data.find((c) => c.id === ch.id)!.unread).toBe(1);
  });

  it('003: public channels come first, then private ones the caller belongs to', async () => {
    const list = (await channels(t.admin)).data;
    const firstPrivate = list.findIndex((c) => c.type !== 'public');
    expect(firstPrivate).toBeGreaterThan(0);
    expect(list.slice(firstPrivate).every((c) => c.type !== 'public')).toBe(true);
  });

  it('003 #2, 005 #1: a private channel is absent from a non-member list and its history is 403', async () => {
    const priv = await createChannel(t.admin, 'secret-room', 'private');
    await say(t.admin, priv.id, 'hidden');
    expect((await channels(bob.token)).data.some((c) => c.id === priv.id)).toBe(false);
    const res = await api.as(bob.token).get(`/v2/team-chat/channels/${priv.id}/messages`);
    expect(res.status).toBe(403);
    expect(code(res)).toBe('TCHAT_NOT_CHANNEL_MEMBER');
    const post = await api
      .as(bob.token)
      .post(`/v2/team-chat/channels/${priv.id}/messages`)
      .send({ body: 'let me in' });
    expect(post.status).toBe(403);
  });

  it('005 #2: any member can read a public channel without a member row', async () => {
    const ch = await createChannel(t.admin, 'open-room');
    await say(t.admin, ch.id, 'hello all');
    const page = await history(bob.token, ch.id);
    expect(page.data.map((m) => m.body)).toEqual(['hello all']);
  });

  it('005 (enhancement): a channel manager adds a person to a private channel, who then sees it; removing them hides it again', async () => {
    const priv = await createChannel(t.admin, 'staffroom', 'private');
    const bobUuid = await userUuid(bob.userId);
    const add = await api
      .as(t.admin)
      .post(`/v2/team-chat/channels/${priv.id}/members`)
      .send({ userId: bobUuid });
    expect(add.status).toBe(204);
    expect((await channels(bob.token)).data.some((c) => c.id === priv.id)).toBe(true);
    const members = await api.as(bob.token).get(`/v2/team-chat/channels/${priv.id}/members`);
    expect(members.body.data.map((m: { name: string }) => m.name).sort()).toEqual([
      'Admin Person',
      'bob',
    ]);
    // bob is not a manager and not the channel admin
    const denied = await api
      .as(bob.token)
      .post(`/v2/team-chat/channels/${priv.id}/members`)
      .send({ userId: bobUuid });
    expect(denied.status).toBe(403);
    const rm = await api.as(t.admin).delete(`/v2/team-chat/channels/${priv.id}/members/${bobUuid}`);
    expect(rm.status).toBe(204);
    expect((await channels(bob.token)).data.some((c) => c.id === priv.id)).toBe(false);
  });

  it('005: a member can leave a private channel; a public channel has no member list to edit', async () => {
    const priv = await createChannel(t.admin, 'leavers', 'private');
    const bobUuid = await userUuid(bob.userId);
    await api
      .as(t.admin)
      .post(`/v2/team-chat/channels/${priv.id}/members`)
      .send({ userId: bobUuid });
    const leave = await api
      .as(bob.token)
      .delete(`/v2/team-chat/channels/${priv.id}/members/${bobUuid}`);
    expect(leave.status).toBe(204);
    const pub = await createChannel(t.admin, 'everyone');
    const res = await api
      .as(t.admin)
      .post(`/v2/team-chat/channels/${pub.id}/members`)
      .send({ userId: bobUuid });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('TCHAT_CHANNEL_KIND_INVALID');
  });

  it('006 #1, #3: an admin deletes a channel (204) and it leaves the list; a non-admin gets 403', async () => {
    const ch = await createChannel(t.admin, 'doomed');
    await say(t.admin, ch.id, 'bye');
    expect((await api.as(bob.token).delete(`/v2/team-chat/channels/${ch.id}`)).status).toBe(403);
    expect((await api.as(t.admin).delete(`/v2/team-chat/channels/${ch.id}`)).status).toBe(204);
    expect((await channels(t.admin)).data.some((c) => c.id === ch.id)).toBe(false);
    expect((await api.as(t.admin).get(`/v2/team-chat/channels/${ch.id}/messages`)).status).toBe(
      404,
    );
    expect(await api.auditCount(t.orgId, 'team_chat_channels', 'delete')).toBeGreaterThan(0);
  });

  it('006 #2: #general cannot be deleted', async () => {
    const g = await general(t.admin);
    const res = await api.as(t.admin).delete(`/v2/team-chat/channels/${g.id}`);
    expect(res.status).toBe(422);
    expect(code(res)).toBe('TCHAT_CHANNEL_PROTECTED');
    expect((await channels(t.admin)).data.some((c) => c.slug === 'general')).toBe(true);
  });

  it('004 (fix): the name of a deleted channel can be used again (Reference failed with a 500)', async () => {
    const ch = await createChannel(t.admin, 'phoenix');
    await api.as(t.admin).delete(`/v2/team-chat/channels/${ch.id}`);
    const again = await createChannel(t.admin, 'phoenix');
    expect(again.id).not.toBe(ch.id);
  });
});

describe('TW-TCHAT-007: direct messages', () => {
  let t: Tenant;
  let ann: { token: string; userId: number };
  let ben: { token: string; userId: number };
  let cy: { token: string; userId: number };
  beforeAll(async () => {
    t = await api.signup('tcd');
    ann = await api.member(t, 'ann', NO_GRANTS);
    ben = await api.member(t, 'ben', NO_GRANTS);
    cy = await api.member(t, 'cy', NO_GRANTS);
  });

  it('#1: opening a DM creates a channel with exactly the two people, and a second open reuses it', async () => {
    const benUuid = await userUuid(ben.userId);
    const first = await api.as(ann.token).post('/v2/team-chat/dm').send({ userId: benUuid });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.type).toBe('dm');
    expect(first.body.peer.name).toBe('ben');
    const second = await api.as(ann.token).post('/v2/team-chat/dm').send({ userId: benUuid });
    expect(second.body.id).toBe(first.body.id);
    // The other person opening it gets the same channel, titled with Ann's name.
    const annUuid = await userUuid(ann.userId);
    const fromBen = await api.as(ben.token).post('/v2/team-chat/dm').send({ userId: annUuid });
    expect(fromBen.body.id).toBe(first.body.id);
    expect(fromBen.body.peer.name).toBe('ann');
    expect(
      await count(
        `SELECT count(*) n FROM team_chat_channel_members m JOIN team_chat_channels c ON c.org_id = m.org_id AND c.id = m.channel_id WHERE c.uuid = $1`,
        [first.body.id],
      ),
    ).toBe(2);
  });

  it('#2: a third person cannot see or use it', async () => {
    const benUuid = await userUuid(ben.userId);
    const dm = (await api.as(ann.token).post('/v2/team-chat/dm').send({ userId: benUuid })).body;
    await say(ann.token, dm.id, 'psst');
    expect((await channels(cy.token)).data.some((c) => c.id === dm.id)).toBe(false);
    expect((await api.as(cy.token).get(`/v2/team-chat/channels/${dm.id}/messages`)).status).toBe(
      403,
    );
    expect((await channels(ben.token)).data.find((c) => c.id === dm.id)).toMatchObject({
      unread: 1,
      peer: { name: 'ann' },
    });
  });

  it('a DM with yourself, or with someone who is not in the workspace, is refused', async () => {
    const self = await api
      .as(ann.token)
      .post('/v2/team-chat/dm')
      .send({ userId: await userUuid(ann.userId) });
    expect(self.status).toBe(422);
    const stranger = await api
      .as(ann.token)
      .post('/v2/team-chat/dm')
      .send({ userId: '00000000-0000-4000-8000-000000000000' });
    expect(stranger.status).toBe(404);
  });
});

describe('TW-TCHAT-008, 009, 011, 012, 014: history, polling, posting, replies, mentions, read pointers', () => {
  let t: Tenant;
  let sam: { token: string; userId: number };
  let g: Channel;
  beforeAll(async () => {
    t = await api.signup('tce');
    sam = await api.member(t, 'sam', NO_GRANTS);
    g = await general(t.admin);
  });

  it('009 #1 (regression of the Reference channel_id defect): a posted message is stored in its channel, comes back in the history, and bumps the channel', async () => {
    const m = await say(t.admin, g.id, 'hello');
    expect(m).toMatchObject({ body: 'hello', channelId: g.id, isMine: true, mentions: [] });
    expect(m.id).toMatch(uuidRe);
    expect(m).not.toHaveProperty('orgId');
    expect((await history(t.admin, g.id)).data.map((x) => x.id)).toContain(m.id);
    const stored = await h.owner.query(
      `SELECT m.channel_id IS NOT NULL AS has_channel, c.last_message_at IS NOT NULL AS bumped,
              (SELECT last_read_message_id FROM team_chat_channel_members r WHERE r.org_id = m.org_id AND r.channel_id = m.channel_id AND r.user_id = m.user_id) AS read_ptr,
              m.id
         FROM team_chat_messages m JOIN team_chat_channels c ON c.org_id = m.org_id AND c.id = m.channel_id WHERE m.uuid = $1`,
      [m.id],
    );
    expect(stored.rows[0].has_channel).toBe(true);
    expect(stored.rows[0].bumped).toBe(true);
    // the author's read pointer is the new message (009 #1)
    expect(Number(stored.rows[0].read_ptr)).toBe(Number(stored.rows[0].id));
    const ev = await api.events(t.orgId, 'teamchat.message.posted');
    expect(ev.some((e) => (e as { uuid?: string }).uuid === m.id)).toBe(true);
  });

  it('009 #4, #5: no text and no file is 422 TCHAT_EMPTY_MESSAGE, and nothing is stored', async () => {
    const before = await count(`SELECT count(*) n FROM team_chat_messages WHERE org_id = $1`, [
      t.orgId,
    ]);
    for (const body of [{}, { body: '   ' }]) {
      const res = await api.as(t.admin).post(`/v2/team-chat/channels/${g.id}/messages`).send(body);
      expect(res.status).toBe(422);
      expect(code(res)).toBe('TCHAT_EMPTY_MESSAGE');
    }
    const tooLong = await api
      .as(t.admin)
      .post(`/v2/team-chat/channels/${g.id}/messages`)
      .send({ body: 'x'.repeat(8193) });
    expect(tooLong.status).toBe(422);
    expect(
      await count(`SELECT count(*) n FROM team_chat_messages WHERE org_id = $1`, [t.orgId]),
    ).toBe(before);
  });

  it('012 #2, #3 / 009 #3: a token naming a workspace member is recorded; one naming an outsider stays text only', async () => {
    const samUuid = await userUuid(sam.userId);
    const other = await api.signup('tcx');
    const outsider = await userUuid(other.adminUserId);
    const m = await say(t.admin, g.id, `hi @[Sam](${samUuid}) and @[Eve](${outsider})`);
    expect(m.mentions).toEqual([samUuid]);
    const ev = await api.events(t.orgId, 'teamchat.mention.created');
    expect(ev.some((e) => (e as { mentionedUserId?: string }).mentionedUserId === samUuid)).toBe(
      true,
    );
    expect(ev.some((e) => (e as { mentionedUserId?: string }).mentionedUserId === outsider)).toBe(
      false,
    );
  });

  it('011 #1, #2: a reply carries a preview of its parent; a parent in another channel is 422', async () => {
    const parent = await say(t.admin, g.id, 'p'.repeat(120));
    const reply = await say(sam.token, g.id, 'agreed', { replyToId: parent.id });
    expect(reply.replyTo).toEqual({
      id: parent.id,
      authorName: 'Admin Person',
      snippet: 'p'.repeat(80),
    });
    const room = await createChannel(t.admin, 'other-room');
    const bad = await api
      .as(sam.token)
      .post(`/v2/team-chat/channels/${room.id}/messages`)
      .send({ body: 'wrong room', replyToId: parent.id });
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('TCHAT_REPLY_OTHER_CHANNEL');
    expect(
      await count(
        `SELECT count(*) n FROM team_chat_messages WHERE org_id = $1 AND body = 'wrong room'`,
        [t.orgId],
      ),
    ).toBe(0);
  });

  it('011: a reply to a deleted message keeps working; the quote simply has no parent', async () => {
    const parent = await say(sam.token, g.id, 'to be removed');
    const reply = await say(t.admin, g.id, 'answering', { replyToId: parent.id });
    expect((await api.as(sam.token).delete(`/v2/team-chat/messages/${parent.id}`)).status).toBe(
      204,
    );
    const page = await history(t.admin, g.id);
    expect(page.data.find((m) => m.id === reply.id)!.replyTo).toBeNull();
  });

  it('009: Idempotency-Key makes a retried POST one message', async () => {
    const send = () =>
      api
        .as(sam.token)
        .post(`/v2/team-chat/channels/${g.id}/messages`)
        .set('Idempotency-Key', 'retry-key-1')
        .send({ body: 'only once' });
    const a = await send();
    const b = await send();
    expect(a.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(
      await count(
        `SELECT count(*) n FROM team_chat_messages WHERE org_id = $1 AND body = 'only once'`,
        [t.orgId],
      ),
    ).toBe(1);
  });

  describe('history and polling (008)', () => {
    let big: Channel;
    beforeAll(async () => {
      big = await createChannel(t.admin, 'big-room');
      // 120 messages straight into the table, one second apart: the API is not what is being measured here.
      await h.owner.query(
        `INSERT INTO team_chat_messages (org_id, channel_id, user_id, body, created_at)
         SELECT $1, c.id, $2, 'msg ' || lpad(n::text, 3, '0'), now() - ((121 - n) || ' seconds')::interval
           FROM generate_series(1, 120) n, team_chat_channels c WHERE c.uuid = $3`,
        [t.orgId, t.adminUserId, big.id],
      );
    });

    it('#1: the newest 50 come back oldest first, hasMore is true, and `before` pages through the rest without a gap or a repeat', async () => {
      const p1 = await history(sam.token, big.id);
      expect(p1.data).toHaveLength(50);
      expect(p1.data[0]!.body).toBe('msg 071');
      expect(p1.data[49]!.body).toBe('msg 120');
      expect(p1.page.hasMore).toBe(true);
      const p2 = await history(
        sam.token,
        big.id,
        `?before=${encodeURIComponent(p1.page.nextCursor!)}`,
      );
      expect(p2.data[0]!.body).toBe('msg 021');
      expect(p2.data[49]!.body).toBe('msg 070');
      const p3 = await history(
        sam.token,
        big.id,
        `?before=${encodeURIComponent(p2.page.nextCursor!)}`,
      );
      expect(p3.data).toHaveLength(20);
      expect(p3.page.hasMore).toBe(false);
      expect(p3.page.nextCursor).toBeNull();
    });

    it('#2: `after` returns only newer messages, oldest first', async () => {
      const p1 = await history(sam.token, big.id);
      const newer = await history(sam.token, big.id, `?after=${p1.data[46]!.id}`);
      expect(newer.data.map((m) => m.body)).toEqual(['msg 118', 'msg 119', 'msg 120']);
      expect((await history(sam.token, big.id, `?after=${p1.data[49]!.id}`)).data).toEqual([]);
    });

    it('#3: limit 5 is raised to 10 and limit 500 is cut to 50', async () => {
      expect((await history(sam.token, big.id, '?limit=5')).data).toHaveLength(10);
      expect((await history(sam.token, big.id, '?limit=500')).data).toHaveLength(50);
    });

    it('a burst larger than a page is read in order by repeated polls (Reference skipped the gap)', async () => {
      const all = await history(sam.token, big.id, '?limit=50');
      const anchor = all.data[0]!; // msg 071: 49 newer in the page, but ask for a small page
      const first = await history(sam.token, big.id, `?after=${anchor.id}&limit=10`);
      expect(first.data.map((m) => m.body)).toEqual(
        Array.from({ length: 10 }, (_, i) => `msg ${String(72 + i).padStart(3, '0')}`),
      );
      expect(first.page.hasMore).toBe(true);
    });

    it('an unknown or forged cursor is refused, and `after` with a message of another channel is 404', async () => {
      const bad = await api
        .as(sam.token)
        .get(`/v2/team-chat/channels/${big.id}/messages?before=bogus`);
      expect(bad.status).toBe(422);
      const m = await say(t.admin, g.id, 'elsewhere');
      const wrong = await api
        .as(sam.token)
        .get(`/v2/team-chat/channels/${big.id}/messages?after=${m.id}`);
      expect(wrong.status).toBe(404);
    });
  });

  describe('read pointers (014)', () => {
    it('#2 (fix): the pointer never moves back', async () => {
      const ch = await createChannel(t.admin, 'pointer-room');
      const ms = [
        await say(t.admin, ch.id, 'a'),
        await say(t.admin, ch.id, 'b'),
        await say(t.admin, ch.id, 'c'),
      ];
      await api
        .as(sam.token)
        .post(`/v2/team-chat/channels/${ch.id}/read`)
        .send({ lastMessageId: ms[2]!.id });
      await api
        .as(sam.token)
        .post(`/v2/team-chat/channels/${ch.id}/read`)
        .send({ lastMessageId: ms[0]!.id });
      expect((await channels(sam.token)).data.find((c) => c.id === ch.id)!.unread).toBe(0);
    });

    it('#3: the first read creates the member row of a public channel; joined_at is not rewritten by later reads', async () => {
      const ch = await createChannel(t.admin, 'joined-room');
      const m = await say(t.admin, ch.id, 'x');
      await api
        .as(sam.token)
        .post(`/v2/team-chat/channels/${ch.id}/read`)
        .send({ lastMessageId: m.id });
      const q = `SELECT joined_at, role FROM team_chat_channel_members mm JOIN team_chat_channels c ON c.org_id = mm.org_id AND c.id = mm.channel_id WHERE c.uuid = $1 AND mm.user_id = $2`;
      const first = (await h.owner.query(q, [ch.id, sam.userId])).rows[0];
      expect(first.role).toBe('member');
      await new Promise((r) => setTimeout(r, 20));
      await api.as(sam.token).post(`/v2/team-chat/channels/${ch.id}/read`).send({});
      const second = (await h.owner.query(q, [ch.id, sam.userId])).rows[0];
      expect(second.joined_at.getTime()).toBe(first.joined_at.getTime());
    });

    it('a message id from another channel cannot be used as the pointer', async () => {
      const ch = await createChannel(t.admin, 'p2-room');
      const m = await say(t.admin, g.id, 'in general');
      const res = await api
        .as(sam.token)
        .post(`/v2/team-chat/channels/${ch.id}/read`)
        .send({ lastMessageId: m.id });
      expect(res.status).toBe(404);
    });
  });

  it('015: the roster lists every active member, and nobody else', async () => {
    const res = await api.as(sam.token).get('/v2/team-chat/members');
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { name: string }) => p.name).sort()).toEqual([
      'Admin Person',
      'sam',
    ]);
    expect(res.body.data[0]).toHaveProperty('email');
    expect(res.body.data[0].id).toMatch(uuidRe);
  });
});

describe('TW-TCHAT-010: attachments', () => {
  let t: Tenant;
  let sam: { token: string; userId: number };
  let g: Channel;
  beforeAll(async () => {
    t = await api.signup('tcf');
    sam = await api.member(t, 'sam', NO_GRANTS);
    g = await general(t.admin);
  });

  const upload = (token: string, channel: string, file: Buffer, name: string, body?: string) => {
    let r = api.as(token).post(`/v2/team-chat/channels/${channel}/messages`);
    if (body !== undefined) r = r.field('body', body);
    return r.attach('attachment', file, name);
  };

  it('#1, #4: a PNG with no text is an attachment-only message that shows as an image', async () => {
    const res = await upload(sam.token, g.id, PNG, 'photo.png');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.body).toBeNull();
    expect(res.body.attachment).toMatchObject({
      name: 'photo.png',
      mime: 'image/png',
      isImage: true,
    });
    expect(res.body.attachment.url).toBe(`/api/v2/team-chat/messages/${res.body.id}/attachment`);
    expect(res.body.attachment.url).not.toMatch(/blob|\.png$/);
  });

  it('the attachment downloads for a member through the authenticated route, inline for an image, with safe headers', async () => {
    const m = (await upload(sam.token, g.id, PNG, 'photo.png', 'look')).body as Message;
    const dl = await api
      .as(t.admin)
      .get(`/v2/team-chat/messages/${m.id}/attachment`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.headers['content-disposition']).toMatch(/^inline;/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-security-policy']).toContain('sandbox');
    expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0);
    expect((await api.http().get(`/v2/team-chat/messages/${m.id}/attachment`)).status).toBe(401);
  });

  it('#3: a PDF keeps its original name and downloads as a file', async () => {
    const m = (await upload(sam.token, g.id, PDF, 'Q3 report.pdf')).body as Message;
    expect(m.attachment).toMatchObject({
      name: 'Q3 report.pdf',
      mime: 'application/pdf',
      isImage: false,
    });
    const dl = await api.as(sam.token).get(`/v2/team-chat/messages/${m.id}/attachment`);
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('a file of another workspace or a private channel the caller is not in cannot be fetched', async () => {
    const priv = await createChannel(t.admin, 'files-private', 'private');
    const m = (await upload(t.admin, priv.id, PDF, 'secret.pdf')).body as Message;
    expect((await api.as(sam.token).get(`/v2/team-chat/messages/${m.id}/attachment`)).status).toBe(
      403,
    );
    const other = await api.signup('tcy');
    expect(
      (await api.as(other.admin).get(`/v2/team-chat/messages/${m.id}/attachment`)).status,
    ).toBe(404);
  });

  it('#2: a file over 20 MB is rejected and nothing is stored', async () => {
    const before = await count(`SELECT count(*) n FROM team_chat_messages WHERE org_id = $1`, [
      t.orgId,
    ]);
    const res = await upload(sam.token, g.id, Buffer.alloc(21 * 1024 * 1024, 1), 'big.txt', 'x');
    expect(res.status).toBe(413);
    expect(
      await count(`SELECT count(*) n FROM team_chat_messages WHERE org_id = $1`, [t.orgId]),
    ).toBe(before);
    expect(
      await count(`SELECT count(*) n FROM team_chat_attachment_blobs WHERE org_id = $1`, [t.orgId]),
    ).toBe(
      await count(
        `SELECT count(*) n FROM team_chat_messages WHERE org_id = $1 AND attachment_path IS NOT NULL`,
        [t.orgId],
      ),
    );
  });

  it('a type that is not on the list (SVG, a script, an executable) is rejected whatever it is called, and leaves no orphan', async () => {
    const before = await count(`SELECT count(*) n FROM team_chat_messages WHERE org_id = $1`, [
      t.orgId,
    ]);
    for (const [file, name] of [
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'x.svg'],
      [Buffer.from('<script>alert(1)</script>'), 'x.png'],
      [Buffer.from('MZ\x90\x00\x03'), 'run.exe'],
    ] as const) {
      const res = await upload(sam.token, g.id, file, name, 'try');
      expect(res.status, name).toBe(422);
      expect(code(res)).toBe('TCHAT_ATTACHMENT_REJECTED');
    }
    expect(
      await count(`SELECT count(*) n FROM team_chat_messages WHERE org_id = $1`, [t.orgId]),
    ).toBe(before);
  });

  it('a rejected reply leaves no stored file (Reference stored it first)', async () => {
    const room = await createChannel(t.admin, 'orphan-room');
    const parent = await say(t.admin, g.id, 'parent');
    const blobs = await count(
      `SELECT count(*) n FROM team_chat_attachment_blobs WHERE org_id = $1`,
      [t.orgId],
    );
    const res = await api
      .as(sam.token)
      .post(`/v2/team-chat/channels/${room.id}/messages`)
      .field('body', 'x')
      .field('replyToId', parent.id)
      .attach('attachment', PNG, 'a.png');
    expect(res.status).toBe(422);
    expect(
      await count(`SELECT count(*) n FROM team_chat_attachment_blobs WHERE org_id = $1`, [t.orgId]),
    ).toBe(blobs);
  });

  it('deleting the message deletes its file (Reference left it behind)', async () => {
    const m = (await upload(sam.token, g.id, PNG, 'gone.png')).body as Message;
    const blobs = await count(
      `SELECT count(*) n FROM team_chat_attachment_blobs WHERE org_id = $1`,
      [t.orgId],
    );
    expect((await api.as(sam.token).delete(`/v2/team-chat/messages/${m.id}`)).status).toBe(204);
    expect(
      await count(`SELECT count(*) n FROM team_chat_attachment_blobs WHERE org_id = $1`, [t.orgId]),
    ).toBe(blobs - 1);
  });
});

describe('TW-TCHAT-016, 017, 018, 019, 020: delete, edit, pin, react, search', () => {
  let t: Tenant;
  let sam: { token: string; userId: number };
  let eve: { token: string; userId: number };
  let mod: { token: string; userId: number };
  let g: Channel;
  beforeAll(async () => {
    t = await api.signup('tcg');
    sam = await api.member(t, 'sam', NO_GRANTS);
    eve = await api.member(t, 'eve', NO_GRANTS);
    mod = await api.member(t, 'mod', [['tchat.message.moderate']]);
    g = await general(t.admin);
  });

  it('016 #1: I delete my message and it leaves the history; an audit row and an event record it', async () => {
    const m = await say(sam.token, g.id, 'oops');
    expect((await api.as(sam.token).delete(`/v2/team-chat/messages/${m.id}`)).status).toBe(204);
    expect((await history(sam.token, g.id)).data.some((x) => x.id === m.id)).toBe(false);
    const ev = await api.events(t.orgId, 'teamchat.message.deleted');
    expect(ev.some((e) => (e as { uuid?: string }).uuid === m.id)).toBe(true);
    expect(await api.auditCount(t.orgId, 'team_chat_messages', 'delete')).toBeGreaterThan(0);
  });

  it("016 #2, #3: another person's message is 403 for a plain member; a moderator and an admin can delete it", async () => {
    const m = await say(sam.token, g.id, 'not yours');
    const refused = await api.as(eve.token).delete(`/v2/team-chat/messages/${m.id}`);
    expect(refused.status).toBe(403);
    expect(code(refused)).toBe('TCHAT_NOT_MESSAGE_AUTHOR');
    expect((await api.as(mod.token).delete(`/v2/team-chat/messages/${m.id}`)).status).toBe(204);
    const m2 = await say(sam.token, g.id, 'also not yours');
    expect((await api.as(t.admin).delete(`/v2/team-chat/messages/${m2.id}`)).status).toBe(204);
  });

  it('016 (fix): a person who is no longer in a private channel cannot delete their old message there', async () => {
    const priv = await createChannel(t.admin, 'ex-members', 'private');
    const samUuid = await userUuid(sam.userId);
    await api
      .as(t.admin)
      .post(`/v2/team-chat/channels/${priv.id}/members`)
      .send({ userId: samUuid });
    const m = await say(sam.token, priv.id, 'written while a member');
    await api.as(t.admin).delete(`/v2/team-chat/channels/${priv.id}/members/${samUuid}`);
    expect((await api.as(sam.token).delete(`/v2/team-chat/messages/${m.id}`)).status).toBe(403);
    expect((await api.as(t.admin).delete(`/v2/team-chat/messages/${m.id}`)).status).toBe(204);
  });

  it('017 #1: I edit my message within 15 minutes; the body and edited_at change', async () => {
    const m = await say(sam.token, g.id, 'before');
    const res = await api
      .as(sam.token)
      .patch(`/v2/team-chat/messages/${m.id}`)
      .send({ body: 'after', rowVersion: m.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ body: 'after' });
    expect(res.body.editedAt).not.toBeNull();
    expect(res.body.rowVersion).toBeGreaterThan(m.rowVersion);
  });

  it('017 #2: a message 20 minutes old cannot be edited', async () => {
    const m = await say(sam.token, g.id, 'old news');
    await h.owner.query(
      `UPDATE team_chat_messages SET created_at = now() - interval '20 minutes' WHERE uuid = $1`,
      [m.id],
    );
    const stored = (
      await h.owner.query(`SELECT row_version FROM team_chat_messages WHERE uuid = $1`, [m.id])
    ).rows[0];
    const res = await api
      .as(sam.token)
      .patch(`/v2/team-chat/messages/${m.id}`)
      .send({ body: 'late', rowVersion: stored.row_version });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('TCHAT_EDIT_WINDOW_EXPIRED');
  });

  it("017 #3: someone else's message is 403, even for an admin; a stale rowVersion is 409", async () => {
    const m = await say(sam.token, g.id, 'mine');
    const other = await api
      .as(t.admin)
      .patch(`/v2/team-chat/messages/${m.id}`)
      .send({ body: 'hijack', rowVersion: m.rowVersion });
    expect(other.status).toBe(403);
    const first = await api
      .as(sam.token)
      .patch(`/v2/team-chat/messages/${m.id}`)
      .send({ body: 'v2', rowVersion: m.rowVersion });
    expect(first.status).toBe(200);
    const stale = await api
      .as(sam.token)
      .patch(`/v2/team-chat/messages/${m.id}`)
      .send({ body: 'v3', rowVersion: m.rowVersion });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
  });

  it('017 (fix): an edit reads the mentions again', async () => {
    const m = await say(sam.token, g.id, 'plain');
    const eveUuid = await userUuid(eve.userId);
    const res = await api
      .as(sam.token)
      .patch(`/v2/team-chat/messages/${m.id}`)
      .send({ body: `now @[Eve](${eveUuid})`, rowVersion: m.rowVersion });
    expect(res.body.mentions).toEqual([eveUuid]);
  });

  it('018 #1: the author pins and unpins by calling twice; the pin shows in the history and the pinned list', async () => {
    const m = await say(sam.token, g.id, 'remember this');
    const on = await api.as(sam.token).post(`/v2/team-chat/messages/${m.id}/pin`);
    expect(on.body).toEqual({ pinned: true });
    expect(
      (await history(sam.token, g.id)).data.find((x) => x.id === m.id)!.pinnedAt,
    ).not.toBeNull();
    const list = await api.as(eve.token).get(`/v2/team-chat/channels/${g.id}/pinned`);
    expect(list.body.data.map((x: Message) => x.id)).toEqual([m.id]);
    const off = await api.as(sam.token).post(`/v2/team-chat/messages/${m.id}/pin`);
    expect(off.body).toEqual({ pinned: false });
    expect(
      (await api.as(eve.token).get(`/v2/team-chat/channels/${g.id}/pinned`)).body.data,
    ).toEqual([]);
  });

  it("018 #2, #3: a plain member cannot pin someone else's message; an admin or a moderator can", async () => {
    const m = await say(sam.token, g.id, 'pin me');
    expect((await api.as(eve.token).post(`/v2/team-chat/messages/${m.id}/pin`)).status).toBe(403);
    expect((await api.as(t.admin).post(`/v2/team-chat/messages/${m.id}/pin`)).body).toEqual({
      pinned: true,
    });
    expect((await api.as(mod.token).post(`/v2/team-chat/messages/${m.id}/pin`)).body).toEqual({
      pinned: false,
    });
  });

  it('019 #1, #2: a reaction toggles; different emojis stack; counts and "mine" are in the history', async () => {
    const m = await say(sam.token, g.id, 'react to me');
    const url = `/v2/team-chat/messages/${m.id}/reactions`;
    const on = await api.as(eve.token).post(url).send({ emoji: '👍' });
    expect(on.body).toMatchObject({
      reacted: true,
      reactions: [{ emoji: '👍', count: 1, mine: true }],
    });
    await api.as(sam.token).post(url).send({ emoji: '👍' });
    await api.as(eve.token).post(url).send({ emoji: '🎉' });
    const seen = (await history(eve.token, g.id)).data.find((x) => x.id === m.id)!;
    expect(seen.reactions).toEqual([
      { emoji: '👍', count: 2, mine: true },
      { emoji: '🎉', count: 1, mine: true },
    ]);
    const off = await api.as(eve.token).post(url).send({ emoji: '👍' });
    expect(off.body.reacted).toBe(false);
    expect(off.body.reactions).toEqual([
      { emoji: '👍', count: 1, mine: false },
      { emoji: '🎉', count: 1, mine: true },
    ]);
  });

  it('019: a string that is not an emoji is 422; a reaction in a private channel needs membership', async () => {
    const m = await say(sam.token, g.id, 'x');
    expect(
      (
        await api
          .as(eve.token)
          .post(`/v2/team-chat/messages/${m.id}/reactions`)
          .send({ emoji: 'thumbs' })
      ).status,
    ).toBe(422);
    const priv = await createChannel(t.admin, 'react-private', 'private');
    const pm = await say(t.admin, priv.id, 'inside');
    expect(
      (
        await api
          .as(eve.token)
          .post(`/v2/team-chat/messages/${pm.id}/reactions`)
          .send({ emoji: '👍' })
      ).status,
    ).toBe(403);
  });

  it('019: two simultaneous identical reactions never fail (Reference raced to a 500)', async () => {
    const m = await say(sam.token, g.id, 'race');
    const url = `/v2/team-chat/messages/${m.id}/reactions`;
    const rs = await Promise.all(
      [1, 2, 3, 4].map(() => api.as(eve.token).post(url).send({ emoji: '🔥' })),
    );
    expect(rs.every((r) => r.status === 200)).toBe(true);
  });

  it('020 #1, #2: a search finds the matching messages, newest first, with their author; one letter is 422', async () => {
    const ch = await createChannel(t.admin, 'search-room');
    await say(sam.token, ch.id, 'quarterly report is ready');
    await say(eve.token, ch.id, 'lunch?');
    await say(eve.token, ch.id, 'Report v2 uploaded');
    const res = await api.as(sam.token).get(`/v2/team-chat/channels/${ch.id}/search?q=report`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((m: Message) => m.body)).toEqual([
      'Report v2 uploaded',
      'quarterly report is ready',
    ]);
    expect(res.body.data[0].authorName).toBe('eve');
    expect((await api.as(sam.token).get(`/v2/team-chat/channels/${ch.id}/search?q=r`)).status).toBe(
      422,
    );
  });

  it('020: wildcards in the search are literal, and a private channel needs membership', async () => {
    const ch = await createChannel(t.admin, 'wild-room');
    await say(sam.token, ch.id, '100% done');
    await say(sam.token, ch.id, '1000 done');
    const res = await api
      .as(sam.token)
      .get(`/v2/team-chat/channels/${ch.id}/search?q=${encodeURIComponent('0% d')}`);
    expect(res.body.data.map((m: Message) => m.body)).toEqual(['100% done']);
    const priv = await createChannel(t.admin, 'search-private', 'private');
    expect(
      (await api.as(eve.token).get(`/v2/team-chat/channels/${priv.id}/search?q=anything`)).status,
    ).toBe(403);
  });
});

describe('TW-TCHAT-021, 022, 023: typing and presence', () => {
  let t: Tenant;
  let sam: { token: string; userId: number };
  let g: Channel;
  beforeAll(async () => {
    t = await api.signup('tch');
    sam = await api.member(t, 'sam', NO_GRANTS);
    g = await general(t.admin);
  });

  it('#1 (021, 022, 023): a ping makes me typing for the others and online for everyone; I am not in my own typing list', async () => {
    await api.as(sam.token).post(`/v2/team-chat/channels/${g.id}/typing`);
    await api.as(sam.token).post('/v2/team-chat/presence');
    const samUuid = await userUuid(sam.userId);
    const seenByAdmin = await api.as(t.admin).get(`/v2/team-chat/channels/${g.id}/activity`);
    expect(seenByAdmin.body.typing).toEqual([samUuid]);
    expect(seenByAdmin.body.online).toEqual([samUuid]);
    const seenBySam = await api.as(sam.token).get(`/v2/team-chat/channels/${g.id}/activity`);
    expect(seenBySam.body.typing).toEqual([]);
    expect(seenBySam.body.online).toEqual([samUuid]);
  });

  it('the keys expire: 8 seconds for typing, 45 for presence', async () => {
    const keys = await h.redis.keys(`tchat:*:${t.orgId}:*`);
    const ttls = await Promise.all(keys.map(async (k) => [k, await h.redis.ttl(k)] as const));
    const typing = ttls.find(([k]) => k.startsWith('tchat:typing'))!;
    const online = ttls.find(([k]) => k.startsWith('tchat:online'))!;
    expect(typing[1]).toBeGreaterThan(0);
    expect(typing[1]).toBeLessThanOrEqual(8);
    expect(online[1]).toBeGreaterThan(8);
    expect(online[1]).toBeLessThanOrEqual(45);
  });

  it('#2 (021): typing in, or asking for the activity of, a private channel the caller cannot open is 403', async () => {
    const priv = await createChannel(t.admin, 'quiet-room', 'private');
    expect((await api.as(sam.token).post(`/v2/team-chat/channels/${priv.id}/typing`)).status).toBe(
      403,
    );
    expect((await api.as(sam.token).get(`/v2/team-chat/channels/${priv.id}/activity`)).status).toBe(
      403,
    );
  });
});

describe('TW-TCHAT-024, 025, 026, 027: invitations', () => {
  let t: Tenant;
  let agent: { token: string; userId: number };
  let agent2: { token: string; userId: number };
  beforeAll(async () => {
    t = await api.signup('tci');
    agent = await api.member(t, 'agent', NO_GRANTS);
    agent2 = await api.member(t, 'agent2', NO_GRANTS);
  });

  const invite = (token: string, body: Record<string, unknown>) =>
    api.as(token).post('/v2/team-chat/invitations').send(body);

  it('024 #1: an agent asking for a newcomer creates a pending request, and an event for the approvers', async () => {
    const res = await invite(agent.token, {
      inviteeEmail: 'New.Person@Example.test',
      inviteeName: 'New Person',
      note: 'from sales',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.message).toMatch(/waiting for admin approval/);
    const row = (
      await h.owner.query(
        `SELECT invitee_email, status FROM team_chat_invitations WHERE uuid = $1`,
        [res.body.id],
      )
    ).rows[0];
    expect(row).toEqual({ invitee_email: 'new.person@example.test', status: 'pending' });
    const ev = await api.events(t.orgId, 'teamchat.invitation.requested');
    expect(ev.some((e) => (e as { uuid?: string }).uuid === res.body.id)).toBe(true);
  });

  it('024 #3: an email already on the roster, with no channel, is 422 "Already a workspace member"', async () => {
    const a2 = (await h.owner.query(`SELECT email FROM users WHERE id = $1`, [agent2.userId]))
      .rows[0].email as string;
    const res = await invite(agent.token, { inviteeEmail: a2 });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('TCHAT_ALREADY_MEMBER');
    expect(res.body.detail).toBe('Already a workspace member');
  });

  it('024 #2: an admin asking is decided on the spot, with the admin as decider; for a person with no account nobody is added and the message says so (Reference said "Member added")', async () => {
    const res = await invite(t.admin, { inviteeEmail: 'ghost@example.test' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('approved');
    expect(res.body.message).not.toBe('Member added');
    const row = (
      await h.owner.query(
        `SELECT decided_by_user_id, decided_at FROM team_chat_invitations WHERE uuid = $1`,
        [res.body.id],
      )
    ).rows[0];
    expect(Number(row.decided_by_user_id)).toBe(t.adminUserId);
    expect(row.decided_at).not.toBeNull();
    const ev = await api.events(t.orgId, 'teamchat.invitation.approved');
    expect(ev.find((e) => (e as { uuid?: string }).uuid === res.body.id)).toMatchObject({
      needsAccount: true,
      inviteeUserId: null,
    });
  });

  it('024 #2 (adding to a private channel): an admin adding an existing member to a private channel adds them at once', async () => {
    const priv = await createChannel(t.admin, 'invite-room', 'private');
    const email = (await h.owner.query(`SELECT email FROM users WHERE id = $1`, [agent2.userId]))
      .rows[0].email as string;
    const res = await invite(t.admin, { inviteeEmail: email, channelId: priv.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.message).toBe('Member added');
    expect((await channels(agent2.token)).data.some((c) => c.id === priv.id)).toBe(true);
    // Asking again for someone already in that channel is refused.
    expect((await invite(t.admin, { inviteeEmail: email, channelId: priv.id })).status).toBe(422);
  });

  it('024 (fix): a channel of another workspace cannot be named', async () => {
    const other = await api.signup('tcz');
    const theirs = await general(other.admin);
    expect(
      (await invite(t.admin, { inviteeEmail: 'x@example.test', channelId: theirs.id })).status,
    ).toBe(404);
  });

  it("025 #1, #3: an admin sees everyone's requests with approve rights; an agent sees only their own", async () => {
    const mine = await invite(agent2.token, { inviteeEmail: 'second@example.test' });
    const adminView = (await api.as(t.admin).get('/v2/team-chat/invitations')).body;
    expect(adminView.isAdmin).toBe(true);
    expect(adminView.data.some((i: { id: string }) => i.id === mine.body.id)).toBe(true);
    expect(adminView.data.length).toBeGreaterThanOrEqual(3);
    expect(adminView.pendingCount).toBeGreaterThanOrEqual(2);
    const agentView = (await api.as(agent2.token).get('/v2/team-chat/invitations')).body;
    expect(agentView.isAdmin).toBe(false);
    expect(agentView.data.map((i: { id: string }) => i.id)).toEqual([mine.body.id]);
    expect(agentView.data[0]).toMatchObject({
      requesterName: 'agent2',
      status: 'pending',
      needsAccount: true,
    });
    expect(agentView.pendingCount).toBe(1);
  });

  it('025 #2: only the newest 50 are listed, newest first, but the badge counts every pending request', async () => {
    const t2 = await api.signup('tcj');
    await h.owner.query(
      `INSERT INTO team_chat_invitations (org_id, requester_user_id, invitee_email, status)
       SELECT $1, $2, 'n' || n || '@example.test', 'pending' FROM generate_series(1, 60) n`,
      [t2.orgId, t2.adminUserId],
    );
    const view = (await api.as(t2.admin).get('/v2/team-chat/invitations')).body;
    expect(view.data).toHaveLength(50);
    expect(view.data[0].inviteeEmail).toBe('n60@example.test');
    expect(view.pendingCount).toBe(60);
  });

  it('026 #1, #2: an admin approves; a request with a channel adds the person to it; deciding again is 422 "Already decided"', async () => {
    const priv = await createChannel(t.admin, 'approve-room', 'private');
    const email = (await h.owner.query(`SELECT email FROM users WHERE id = $1`, [agent.userId]))
      .rows[0].email as string;
    // Requested by the agent for a channel they cannot see: a request needs access to the channel, so the admin files it.
    const asked = await invite(agent2.token, {
      inviteeEmail: email,
      channelId: (await createChannel(t.admin, 'visible-room')).id,
    });
    expect(asked.status).toBe(422); // public channel: everyone is already in it
    // The agent asks for a private channel they are a member of.
    await api
      .as(t.admin)
      .post(`/v2/team-chat/channels/${priv.id}/members`)
      .send({ userId: await userUuid(agent2.userId) });
    const pending = await invite(agent2.token, { inviteeEmail: email, channelId: priv.id });
    expect(pending.status, JSON.stringify(pending.body)).toBe(201);
    expect(pending.body.status).toBe('pending');
    const ok = await api.as(t.admin).post(`/v2/team-chat/invitations/${pending.body.id}/approve`);
    expect(ok.status).toBe(200);
    expect((await channels(agent.token)).data.some((c) => c.id === priv.id)).toBe(true);
    const row = (
      await h.owner.query(
        `SELECT status, decided_by_user_id FROM team_chat_invitations WHERE uuid = $1`,
        [pending.body.id],
      )
    ).rows[0];
    expect(row.status).toBe('approved');
    expect(Number(row.decided_by_user_id)).toBe(t.adminUserId);
    const again = await api
      .as(t.admin)
      .post(`/v2/team-chat/invitations/${pending.body.id}/approve`);
    expect(again.status).toBe(422);
    expect(code(again)).toBe('TCHAT_INVITATION_DECIDED');
    expect(again.body.detail).toBe('Already decided');
    expect(await api.auditCount(t.orgId, 'team_chat_invitations', 'update')).toBeGreaterThan(0);
  });

  it('026 #4, 027 #3: a non-admin cannot approve or decline', async () => {
    const pending = await invite(agent.token, { inviteeEmail: 'later@example.test' });
    expect(
      (await api.as(agent.token).post(`/v2/team-chat/invitations/${pending.body.id}/approve`))
        .status,
    ).toBe(403);
    expect(
      (await api.as(agent.token).post(`/v2/team-chat/invitations/${pending.body.id}/decline`))
        .status,
    ).toBe(403);
  });

  it('027 #1, #2: declining sets declined and adds nobody; declining again is 422; a declined email may be requested again', async () => {
    const pending = await invite(agent.token, { inviteeEmail: 'declined@example.test' });
    const ok = await api.as(t.admin).post(`/v2/team-chat/invitations/${pending.body.id}/decline`);
    expect(ok.status).toBe(200);
    const row = (
      await h.owner.query(
        `SELECT status, decided_by_user_id FROM team_chat_invitations WHERE uuid = $1`,
        [pending.body.id],
      )
    ).rows[0];
    expect(row.status).toBe('declined');
    expect(Number(row.decided_by_user_id)).toBe(t.adminUserId);
    expect(
      (await api.as(t.admin).post(`/v2/team-chat/invitations/${pending.body.id}/decline`)).status,
    ).toBe(422);
    expect((await invite(agent.token, { inviteeEmail: 'declined@example.test' })).status).toBe(201);
  });

  it('two admins deciding at once: exactly one wins', async () => {
    const pending = await invite(agent.token, { inviteeEmail: 'race@example.test' });
    const rs = await Promise.all([
      api.as(t.admin).post(`/v2/team-chat/invitations/${pending.body.id}/approve`),
      api.as(t.admin).post(`/v2/team-chat/invitations/${pending.body.id}/decline`),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 422]);
  });

  it('an invitation of another workspace is 404', async () => {
    const other = await api.signup('tck');
    const theirs = await invite(other.admin, { inviteeEmail: 'z@example.test' });
    expect(
      (await api.as(t.admin).post(`/v2/team-chat/invitations/${theirs.body.id}/approve`)).status,
    ).toBe(404);
  });
});

describe('tenant isolation and shape', () => {
  it('rows of one workspace are invisible to another through the restricted role (RLS), and responses carry no internal id', async () => {
    const a = await api.signup('tcm');
    const b = await api.signup('tcn');
    const ga = await general(a.admin);
    await say(a.admin, ga.id, 'a-only');
    const gb = await general(b.admin);
    const hb = await history(b.admin, gb.id);
    expect(hb.data).toEqual([]);
    const list = await channels(a.admin);
    expect(JSON.stringify(list)).not.toMatch(/"(orgId|org_id|userId)":/);
    const msg = await say(a.admin, ga.id, 'shape');
    for (const key of Object.keys(msg)) expect(key).not.toMatch(/^(orgId|userId|internalId)$/);
  });
});
