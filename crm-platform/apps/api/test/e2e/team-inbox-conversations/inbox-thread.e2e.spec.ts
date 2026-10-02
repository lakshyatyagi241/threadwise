import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT, Api, Inbox, PNG, startHarness, uuidRe, type Harness, type Tenant } from './support';

/**
 * The thread an agent works in (plan-inbox-chat.md Phase 1, routes 12 to 15 and 21): paging the messages gap-free, sending (202, queued,
 * idempotent), the refusals that come before anything is stored, retrying a failed send, clearing unread, and attachments. The message
 * pipeline itself (the worker, receipts) is the conversation core's and has its own tests; here the worker does not run, so a sent
 * message stays `queued`.
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

interface Msg {
  id: string;
  seq: number;
  direction: string;
  status: string;
  body: string | null;
  clientMessageId: string | null;
  media: { url: string; mime: string } | null;
}
interface Thread {
  data: Msg[];
  page: { hasMoreBefore: boolean; hasMoreAfter: boolean; limit: number };
}

const thread = async (token: string, uuid: string, qs = ''): Promise<Thread> => {
  const res = await api.as(token).get(`/v2/inbox/conversations/${uuid}/messages${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Thread;
};

const text = (body = 'Hello there') => ({
  kind: 'text',
  body,
  clientMessageId: randomUUID(),
});

describe('reading the thread: gap-free by seq', () => {
  let t: Tenant;
  let agent: { token: string; userId: number };
  let conv: { id: number; uuid: string };

  beforeAll(async () => {
    t = await api.signup('itr');
    agent = await api.member(t, 'agent', AGENT);
    const ch = await inbox.channel(t.admin);
    conv = await inbox.conversation(t, ch.id, { messages: 120 });
  });

  it('returns the newest 50 in ascending order, and says there are older ones', async () => {
    const p = await thread(agent.token, conv.uuid);
    expect(p.data).toHaveLength(50);
    expect(p.data[0]!.seq).toBe(71);
    expect(p.data[49]!.seq).toBe(120);
    expect(p.page).toMatchObject({ hasMoreBefore: true, hasMoreAfter: false, limit: 50 });
    expect(p.data.every((m) => uuidRe.test(m.id))).toBe(true);
  });

  it('pages back with before and reaches the first message with no gap and no repeat', async () => {
    const all: number[] = [];
    let p = await thread(agent.token, conv.uuid, '?limit=40');
    all.unshift(...p.data.map((m) => m.seq));
    while (p.page.hasMoreBefore) {
      p = await thread(agent.token, conv.uuid, `?limit=40&before=${p.data[0]!.seq}`);
      all.unshift(...p.data.map((m) => m.seq));
    }
    expect(all).toHaveLength(120);
    expect(all).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
  });

  it('afterSeq returns only newer messages, oldest first, and flags a burst that did not fit', async () => {
    const p = await thread(agent.token, conv.uuid, '?afterSeq=100&limit=10');
    expect(p.data.map((m) => m.seq)).toEqual(Array.from({ length: 10 }, (_, i) => 101 + i));
    expect(p.page.hasMoreAfter).toBe(true);
    const rest = await thread(agent.token, conv.uuid, '?afterSeq=110&limit=50');
    expect(rest.data.map((m) => m.seq)).toEqual(Array.from({ length: 10 }, (_, i) => 111 + i));
    expect(rest.page.hasMoreAfter).toBe(false);
    expect((await thread(agent.token, conv.uuid, '?afterSeq=120')).data).toEqual([]);
  });

  it('refuses both cursors at once and an out-of-range limit with a validation error', async () => {
    const both = await api
      .as(agent.token)
      .get(`/v2/inbox/conversations/${conv.uuid}/messages?before=5&afterSeq=3`);
    expect(both.status).toBe(422);
    expect(
      (await api.as(agent.token).get(`/v2/inbox/conversations/${conv.uuid}/messages?limit=101`))
        .status,
    ).toBe(422);
  });

  it('hands out a media link only to someone who may see the conversation, and never the storage key', async () => {
    const ch = await inbox.channel(t.admin);
    const own = await api.member(t, 'ownonly', [['inbox.conversation.read', 'own']]);
    const withMedia = await inbox.conversation(t, ch.id, {
      messages: 0,
      lastMessageAt: new Date().toISOString(),
    });
    await inbox.message(t, withMedia.id, 1, {
      mediaKey: `chat/${t.orgId}/2026/10/secret_key_abc.png`,
    });
    await h.owner.query(`UPDATE conversations SET msg_seq = 1 WHERE id = $1`, [withMedia.id]);

    const seen = await thread(agent.token, withMedia.uuid);
    expect(seen.data[0]!.media!.url).toMatch(/^\/api\/v2\/media\/[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(seen)).not.toContain('secret_key_abc');

    // The same conversation for an agent whose scope does not cover it: not found, so no link was ever minted for them.
    const hidden = await api
      .as(own.token)
      .get(`/v2/inbox/conversations/${withMedia.uuid}/messages`);
    expect(hidden.status).toBe(404);
    expect(JSON.stringify(hidden.body)).not.toContain('/api/v2/media');
  });
});

describe('sending: 202, queued, idempotent, and refused before anything is stored', () => {
  let t: Tenant;
  let agent: { token: string; userId: number };
  let reader: { token: string };
  let ownReplier: { token: string; userId: number };
  let conv: { id: number; uuid: string };
  let ch: { id: string; rowVersion: number };

  beforeAll(async () => {
    t = await api.signup('its');
    agent = await api.member(t, 'agent', AGENT);
    reader = await api.member(t, 'reader', [['inbox.conversation.read', 'all']]);
    ownReplier = await api.member(t, 'ownreply', [
      ['inbox.conversation.read', 'all'],
      ['inbox.conversation.reply', 'own'],
    ]);
    ch = await inbox.channel(t.admin);
    conv = await inbox.conversation(t, ch.id, {
      messages: 2,
      lastInboundAt: new Date().toISOString(),
    });
  });

  const rows = async (id: number) =>
    (
      await h.owner.query(
        `SELECT * FROM messages WHERE conversation_id = $1 AND direction = 'out' ORDER BY seq`,
        [id],
      )
    ).rows;

  it('answers 202 with the stored message: queued, the next seq, the sender, the client id', async () => {
    const body = text('Hi, how can I help?');
    const res = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({
      conversationId: conv.uuid,
      seq: 3,
      direction: 'out',
      kind: 'text',
      status: 'queued',
      body: 'Hi, how can I help?',
      clientMessageId: body.clientMessageId,
    });
    expect(res.body.sender.kind).toBe('agent');
    expect(res.body.id).toMatch(uuidRe);
    // The thread shows it, and the conversation row moved: preview and sequence.
    const row = await inbox.row(conv.uuid);
    expect(row.preview).toBe('Hi, how can I help?');
    expect(Number(row.msg_seq)).toBe(3);
    const p = await thread(agent.token, conv.uuid, '?afterSeq=2');
    expect(p.data.map((m) => m.id)).toEqual([res.body.id]);
  });

  it('the same clientMessageId returns the same message and stores one row', async () => {
    const body = text('only once');
    const a = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send(body);
    const b = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send(body);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.seq).toBe(a.body.seq);
    expect((await rows(conv.id)).filter((r) => r.body === 'only once')).toHaveLength(1);
  });

  it('a repeated Idempotency-Key replays the stored answer, and a different body under it is refused', async () => {
    const key = `k-${randomUUID()}`;
    const body = text('with a key');
    const a = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .set('idempotency-key', key)
      .send(body);
    const b = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .set('idempotency-key', key)
      .send(body);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(b.body.id).toBe(a.body.id);
    expect((await rows(conv.id)).filter((r) => r.body === 'with a key')).toHaveLength(1);
  });

  it('the same clientMessageId on another conversation is refused, not answered with the first one', async () => {
    const other = await inbox.conversation(t, ch.id, { lastInboundAt: new Date().toISOString() });
    const body = text('reused id');
    expect(
      (await api.as(agent.token).post(`/v2/inbox/conversations/${conv.uuid}/messages`).send(body))
        .status,
    ).toBe(202);
    const clash = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${other.uuid}/messages`)
      .send(body);
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('validates the body: empty, too long, no client id, a bad kind', async () => {
    const post = (b: unknown) =>
      api
        .as(agent.token)
        .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
        .send(b as object);
    expect((await post({ kind: 'text', body: '   ', clientMessageId: randomUUID() })).status).toBe(
      422,
    );
    expect(
      (await post({ kind: 'text', body: 'x'.repeat(4097), clientMessageId: randomUUID() })).status,
    ).toBe(422);
    expect((await post({ kind: 'text', body: 'x' })).status).toBe(422);
    expect((await post({ kind: 'voice', clientMessageId: randomUUID() })).status).toBe(422);
    expect((await post({ kind: 'text', body: 'x', clientMessageId: 'not-a-uuid' })).status).toBe(
      422,
    );
  });

  it('a template is refused while the template library is not part of the deployment', async () => {
    const res = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send({ kind: 'template', templateId: randomUUID(), clientMessageId: randomUUID() });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INBOX_TEMPLATES_UNAVAILABLE');
  });

  it('needs the reply permission; a read-only member gets 403 and nothing is stored', async () => {
    const before = (await rows(conv.id)).length;
    const res = await api
      .as(reader.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send(text());
    expect(res.status).toBe(403);
    expect((await rows(conv.id)).length).toBe(before);
  });

  it('reply scope own covers only the conversations assigned to the caller (403 elsewhere, 202 on theirs)', async () => {
    const res = await api
      .as(ownReplier.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send(text());
    expect(res.status).toBe(403);
    const mine = await inbox.conversation(t, ch.id, {
      assigneeUserId: ownReplier.userId,
      lastInboundAt: new Date().toISOString(),
    });
    const ok = await api
      .as(ownReplier.token)
      .post(`/v2/inbox/conversations/${mine.uuid}/messages`)
      .send(text());
    expect(ok.status).toBe(202);
  });

  it('refuses a free-form message outside the 24 hour window with SERVICE_WINDOW_CLOSED and stores nothing', async () => {
    const stale = await inbox.conversation(t, ch.id, {
      lastInboundAt: new Date(Date.now() - 30 * 3600_000).toISOString(),
    });
    const res = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${stale.uuid}/messages`)
      .send(text());
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SERVICE_WINDOW_CLOSED');
    expect(await rows(stale.id)).toHaveLength(0);
  });

  it('refuses a send on a channel that is not connected with CHANNEL_DISCONNECTED', async () => {
    const off = await inbox.channel(t.admin, { name: 'Off' });
    const c = await inbox.conversation(t, off.id, { lastInboundAt: new Date().toISOString() });
    const patch = await api
      .as(t.admin)
      .patch(`/v2/channels/${off.id}`)
      .send({ rowVersion: 1, status: 'disconnected' });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    const res = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${c.uuid}/messages`)
      .send(text());
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CHANNEL_DISCONNECTED');
    expect(await rows(c.id)).toHaveLength(0);
  });

  it('quotes a message of the same conversation, and refuses a quote of one that is not in it', async () => {
    const first = (await rows(conv.id))[0]!;
    const ok = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send({ ...text('answering that'), replyToMessageId: first.uuid });
    expect(ok.status).toBe(202);
    expect(ok.body.replyToMessageId).toBe(first.uuid);
    const bad = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send({ ...text('answering nothing'), replyToMessageId: randomUUID() });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
  });
});

describe('retry and read', () => {
  let t: Tenant;
  let agent: { token: string; userId: number };
  let reader: { token: string };
  let conv: { id: number; uuid: string };
  let unreadConv: { id: number; uuid: string };

  beforeAll(async () => {
    t = await api.signup('itx');
    agent = await api.member(t, 'agent', AGENT);
    reader = await api.member(t, 'reader', [['inbox.conversation.read', 'all']]);
    const ch = await inbox.channel(t.admin);
    conv = await inbox.conversation(t, ch.id, {
      messages: 4,
      unread: 4,
      lastInboundAt: new Date().toISOString(),
    });
    unreadConv = await inbox.conversation(t, ch.id, { messages: 4, unread: 4 });
  });

  it('puts a failed outbound message back to queued (202) and clears its failure', async () => {
    const failed = await inbox.message(t, conv.id, 5, {
      direction: 'out',
      status: 'failed',
      failureCode: 'SIM_REJECTED',
    });
    const res = await api.as(agent.token).post(`/v2/inbox/messages/${failed.uuid}/retry`);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.id).toBe(failed.uuid);
    expect(res.body.status).toBe('queued');
    expect(res.body.failure).toBeNull();
  });

  it('refuses to retry a message that did not fail, an inbound one, and one that does not exist', async () => {
    const sent = await inbox.message(t, conv.id, 6, { direction: 'out', status: 'sent' });
    const notFailed = await api.as(agent.token).post(`/v2/inbox/messages/${sent.uuid}/retry`);
    expect(notFailed.body.code).toBe('MESSAGE_NOT_RETRYABLE');
    const inbound = await inbox.message(t, conv.id, 7, {});
    expect(
      (await api.as(agent.token).post(`/v2/inbox/messages/${inbound.uuid}/retry`)).body.code,
    ).toBe('MESSAGE_NOT_RETRYABLE');
    const gone = await api.as(agent.token).post(`/v2/inbox/messages/${randomUUID()}/retry`);
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe('MESSAGE_NOT_FOUND');
  });

  it('retry needs the reply permission', async () => {
    const failed = await inbox.message(t, conv.id, 8, { direction: 'out', status: 'failed' });
    expect(
      (await api.as(reader.token).post(`/v2/inbox/messages/${failed.uuid}/retry`)).status,
    ).toBe(403);
  });

  it('read clears unread up to a seq and leaves what arrived after it unread; it never goes up', async () => {
    const read = (upToSeq: number) =>
      api.as(agent.token).post(`/v2/inbox/conversations/${unreadConv.uuid}/read`).send({ upToSeq });
    const some = await read(2);
    expect(some.status, JSON.stringify(some.body)).toBe(200);
    expect(some.body).toEqual({ conversationId: unreadConv.uuid, unreadCount: 2 });
    // An older marker cannot make the thread more unread again.
    expect((await read(1)).body.unreadCount).toBe(2);
    expect((await read(4)).body.unreadCount).toBe(0);
    expect(Number((await inbox.row(unreadConv.uuid)).unread_count)).toBe(0);
  });

  it('read validates its body and is visible to anyone who may read', async () => {
    const res = await api
      .as(reader.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/read`)
      .send({ upToSeq: -1 });
    expect(res.status).toBe(422);
    const ok = await api
      .as(reader.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/read`)
      .send({ upToSeq: 0 });
    expect(ok.status).toBe(200);
  });
});

describe('attachments: upload before sending', () => {
  let t: Tenant;
  let other: Tenant;
  let agent: { token: string; userId: number };
  let colleague: { token: string; userId: number };
  let reader: { token: string };
  let conv: { id: number; uuid: string };

  const upload = (token: string, buffer: Buffer, filename: string) =>
    api.as(token).post('/v2/inbox/media').attach('file', buffer, filename);

  beforeAll(async () => {
    t = await api.signup('itm');
    other = await api.signup('itn');
    agent = await api.member(t, 'agent', AGENT);
    colleague = await api.member(t, 'colleague', AGENT);
    reader = await api.member(t, 'reader', [['inbox.conversation.read', 'all']]);
    const ch = await inbox.channel(t.admin);
    conv = await inbox.conversation(t, ch.id, { lastInboundAt: new Date().toISOString() });
  });

  it('stores an image by its content and answers an id, a kind, a preview link and an expiry', async () => {
    const res = await upload(agent.token, PNG, 'photo.png');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      name: 'photo.png',
      sizeBytes: PNG.length,
    });
    expect(res.body.id).toMatch(uuidRe);
    expect(res.body.previewUrl).toMatch(/^\/api\/v2\/media\//);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect(JSON.stringify(res.body)).not.toContain(`chat/${t.orgId}`);
  });

  it('refuses a script renamed to .png, a file with no content, and a request with no file', async () => {
    const script = await upload(agent.token, Buffer.from('<script>alert(1)</script>'), 'cute.png');
    expect(script.status).toBe(422);
    expect(script.body.code).toBe('AUTH_UPLOAD_REJECTED');
    const html = await upload(
      agent.token,
      Buffer.from('<html><body>hi</body></html>'),
      'page.html',
    );
    expect(html.status).toBe(422);
    const empty = await upload(agent.token, Buffer.alloc(0), 'empty.png');
    expect(empty.status).toBe(422);
    const none = await api.as(agent.token).post('/v2/inbox/media');
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('VALIDATION_FAILED');
  });

  it('needs the reply permission to upload', async () => {
    expect((await upload(reader.token, PNG, 'photo.png')).status).toBe(403);
  });

  it('sends the attachment as a media message with a caption; the thread links it, never exposing the key', async () => {
    const up = await upload(agent.token, PNG, 'photo.png');
    const body = {
      kind: 'media',
      mediaId: up.body.id,
      caption: 'Here is the photo',
      clientMessageId: randomUUID(),
    };
    const res = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({ kind: 'image', status: 'queued', body: 'Here is the photo' });
    expect(res.body.media.url).toMatch(/^\/api\/v2\/media\//);
    expect(res.body.media.mime).toBe('image/png');
    const stored = await h.owner.query(`SELECT media_key FROM messages WHERE uuid = $1`, [
      res.body.id,
    ]);
    expect(stored.rows[0].media_key).toMatch(new RegExp(`^chat/${t.orgId}/`));
    expect(JSON.stringify(res.body)).not.toContain(stored.rows[0].media_key);
    const link = await api.as(agent.token).get(res.body.media.url.replace('/api', ''));
    expect(link.status).toBe(200);
    expect(link.headers['content-type']).toBe('image/png');
  });

  it('a retry of the same send returns the first message; a different send cannot reuse the file', async () => {
    const up = await upload(agent.token, PNG, 'photo.png');
    const body = { kind: 'media', mediaId: up.body.id, clientMessageId: randomUUID() };
    const a = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send(body);
    const b = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send(body);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(b.body.id).toBe(a.body.id);
    const second = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send({ ...body, clientMessageId: randomUUID() });
    expect(second.status).toBe(422);
    expect(second.body.code).toBe('MESSAGE_MEDIA_NOT_FOUND');
  });

  it("refuses another agent's upload, another workspace's upload, an unknown id and an expired one", async () => {
    const mine = await upload(agent.token, PNG, 'photo.png');
    const send = (token: string, mediaId: string, c = conv.uuid) =>
      api
        .as(token)
        .post(`/v2/inbox/conversations/${c}/messages`)
        .send({ kind: 'media', mediaId, clientMessageId: randomUUID() });
    const stolen = await send(colleague.token, mine.body.id);
    expect(stolen.status).toBe(422);
    expect(stolen.body.code).toBe('MESSAGE_MEDIA_NOT_FOUND');
    const foreign = await upload(other.admin, PNG, 'photo.png');
    expect((await send(agent.token, foreign.body.id)).body.code).toBe('MESSAGE_MEDIA_NOT_FOUND');
    expect((await send(agent.token, randomUUID())).body.code).toBe('MESSAGE_MEDIA_NOT_FOUND');
    await h.owner.query(
      `UPDATE conversation_media_uploads SET expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [mine.body.id],
    );
    expect((await send(agent.token, mine.body.id)).body.code).toBe('MESSAGE_MEDIA_NOT_FOUND');
  });

  it('a send that is refused (window closed) gives the attachment back, so it can be used again', async () => {
    const up = await upload(agent.token, PNG, 'photo.png');
    const ch = await inbox.channel(t.admin);
    const stale = await inbox.conversation(t, ch.id, {
      lastInboundAt: new Date(Date.now() - 40 * 3600_000).toISOString(),
    });
    const refused = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${stale.uuid}/messages`)
      .send({ kind: 'media', mediaId: up.body.id, clientMessageId: randomUUID() });
    expect(refused.body.code).toBe('SERVICE_WINDOW_CLOSED');
    const ok = await api
      .as(agent.token)
      .post(`/v2/inbox/conversations/${conv.uuid}/messages`)
      .send({ kind: 'media', mediaId: up.body.id, clientMessageId: randomUUID() });
    expect(ok.status, JSON.stringify(ok.body)).toBe(202);
  });

  it("the media route refuses another workspace's key and a link minted for someone else", async () => {
    const up = await upload(agent.token, PNG, 'photo.png');
    const stranger = await api.as(other.admin).get(up.body.previewUrl.replace('/api', ''));
    expect(stranger.status).toBe(404);
    const colleagueTry = await api.as(colleague.token).get(up.body.previewUrl.replace('/api', ''));
    expect(colleagueTry.status).toBe(404);
    const mine = await api.as(agent.token).get(up.body.previewUrl.replace('/api', ''));
    expect(mine.status).toBe(200);
  });
});
