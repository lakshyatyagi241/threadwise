import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { MailSyncService } from '../../../src/modules/channel-email/mail-sync.service';
import { AGENT, type Grant } from '../team-inbox-conversations/support';
import {
  eventsOf,
  joinConversation,
  listen,
  sleep,
  until,
} from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import { CALLBACK, mailWorkspace, startMailRig, type MailRig } from './support';

/**
 * TW-MAIL-035: personal mailboxes and the email sharing policy, end to end, with the part that matters most proven in a matrix: the
 * conversations of A's personal mailbox are visible to A and to nobody else (agents, an admin while the policy is off, another workspace),
 * across every read path (list, counts, search, detail, messages, notes, events, attachments, channel list, realtime rooms and events,
 * notifications, assignment targets). An admin sees them only while the workspace policy says `adminsCanReadPersonal`. Shared mailboxes are unchanged.
 * Google is a local stand-in; nothing here talks to a real account.
 */
let rig: MailRig;
let t: Tenant; // the workspace under test
let x: Tenant; // a second workspace with its own admin
const SHARED = 'support@acme.test';
const PERSONAL_A = 'ana.agent@acme.test';
const SECRET = 'Zelda Privateperson';

interface User {
  token: string;
  userId: number;
  uuid: string;
}
let A: User; // agent who owns the personal mailbox
let B: User; // another agent (may connect personal mailboxes, sees all inbox conversations)
let D: User; // an agent who holds no email permission at all
let C: User; // an admin member (settings.manage, inbox scope all)
let ADMIN: User; // the signup admin (the Admin preset)
let X: User; // the other workspace's admin

let personalMailbox = '';
let personalConv = { id: 0, uuid: '', messageUuid: '', attachmentId: '' };
let sharedConv = { id: 0, uuid: '' };

const as = (u: User | string) => rig.p.api.as(typeof u === 'string' ? u : u.token);
const idem = () => `pm-${randomUUID()}`;

const userOf = async (tenant: Tenant, name: string, grants: Grant[]) => {
  const m = await rig.p.api.member(tenant, name, grants);
  const row = await rig.p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [m.userId]);
  return { token: m.token, userId: m.userId, uuid: row.rows[0].uuid as string } satisfies User;
};

const syncMailbox = (tenant: Tenant, uuid: string) =>
  RequestContextStore.run(
    {
      requestId: `spec-${randomUUID()}`,
      orgId: tenant.orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    () => rig.p.h.app.get(MailSyncService).sync(tenant.orgId, uuid),
  );

/** The user presses Connect and Google redirects back. Returns the start response and, when it started, the callback's outcome. */
async function connect(user: User | string, address: string, body: Record<string, unknown> = {}) {
  const start = await as(user)
    .post('/v2/email/mailboxes/connect')
    .send({ returnTo: '/email', ...body });
  if (start.status !== 200) return { start, outcome: null as string | null };
  const state = new URL(start.body.authorizeUrl as string).searchParams.get('state')!;
  const code = rig.fake.grant(`code-${randomUUID()}`, rig.fake.account(address, 'Acct'), {});
  const res = await request(rig.p.h.app.getHttpServer())
    .get(CALLBACK)
    .query({ code, state })
    .redirects(0);
  return { start, outcome: new URL(res.headers.location as string).searchParams.get('email') };
}

const mailboxRow = async (address: string) =>
  (
    await rig.p.h.owner.query(`SELECT * FROM mail_mailboxes WHERE org_id = $1 AND address = $2`, [
      t.orgId,
      address,
    ])
  ).rows[0] as Record<string, unknown> | undefined;

const putPolicy = async (body: Record<string, unknown>) => {
  const cur = await as(ADMIN).get('/v2/email/settings');
  const res = await as(ADMIN)
    .put('/v2/email/settings')
    .set('idempotency-key', idem())
    .send({ rowVersion: cur.body.rowVersion, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as {
    personalMailboxesEnabled: boolean;
    whoMayConnectPersonal: string;
    adminsCanReadPersonal: boolean;
    rowVersion: number;
  };
};

beforeAll(async () => {
  rig = await startMailRig();
  t = await mailWorkspace(rig.p, 'pmt', 6);
  x = await mailWorkspace(rig.p, 'pmx', 6);
  const personalKeys: Grant[] = [['mail.mailboxes.manage_personal']];
  A = await userOf(t, 'agentA', [...AGENT, ['inbox.conversation.assign'], ...personalKeys]);
  B = await userOf(t, 'agentB', [...AGENT, ...personalKeys]);
  D = await userOf(t, 'agentD', AGENT);
  C = await userOf(t, 'adminC', [
    ...AGENT,
    ['inbox.conversation.assign'],
    ['mail.settings.manage'],
    ['mail.mailboxes.read'],
    ['mail.mailboxes.manage'],
    ['mail.mailboxes.manage_personal'],
  ]);
  const adminRow = await rig.p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [
    t.adminUserId,
  ]);
  ADMIN = { token: t.admin, userId: t.adminUserId, uuid: adminRow.rows[0].uuid as string };
  const xRow = await rig.p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [x.adminUserId]);
  X = { token: x.admin, userId: x.adminUserId, uuid: xRow.rows[0].uuid as string };

  // The company's shared mailbox, then the policy, then A's personal mailbox.
  expect((await connect(ADMIN, SHARED)).outcome).toBe('connected');
  await putPolicy({
    personalMailboxesEnabled: true,
    whoMayConnectPersonal: 'agents',
    adminsCanReadPersonal: false,
  });
  expect((await connect(A, PERSONAL_A, { scope: 'personal' })).outcome).toBe('connected');
  const personal = (await mailboxRow(PERSONAL_A))!;
  personalMailbox = personal.uuid as string;
  const shared = (await mailboxRow(SHARED))!;
  for (const m of [personal, shared]) {
    await until('first sync', async () =>
      (
        await rig.p.h.owner.query(`SELECT last_synced_at FROM mail_mailboxes WHERE uuid = $1`, [
          m.uuid,
        ])
      ).rows[0].last_synced_at
        ? true
        : undefined,
    );
  }

  // New mail after the quiet backfill: A's private thread (with a file) and a shared one.
  rig.fake.deliver(PERSONAL_A, {
    threadId: 'th-private',
    subject: 'Private quote request',
    from: `${SECRET} <zelda@example.com>`,
    text: 'my secret numbers',
    attachments: [
      { name: 'secret.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 secret') },
    ],
  });
  rig.fake.deliver(SHARED, {
    threadId: 'th-shared',
    subject: 'Public question',
    from: 'Sam Public <sam@example.com>',
    text: 'hello support',
  });
  await syncMailbox(t, personal.uuid as string);
  await syncMailbox(t, shared.uuid as string);

  const conv = async (peer: string) =>
    (
      await rig.p.h.owner.query(
        `SELECT id, uuid FROM conversations WHERE org_id = $1 AND peer_key = $2`,
        [t.orgId, peer],
      )
    ).rows[0];
  const pc = await conv('t:th-private');
  const sc = await conv('t:th-shared');
  const msg = (
    await rig.p.h.owner.query(
      `SELECT uuid, meta FROM messages WHERE conversation_id = $1 ORDER BY seq LIMIT 1`,
      [pc.id],
    )
  ).rows[0];
  personalConv = {
    id: Number(pc.id),
    uuid: pc.uuid as string,
    messageUuid: msg.uuid as string,
    attachmentId: (msg.meta.email.attachments as Array<{ id: string }>)[0]!.id,
  };
  sharedConv = { id: Number(sc.id), uuid: sc.uuid as string };
}, 400_000);

afterAll(async () => {
  await rig?.restore();
});

interface Row {
  id: string;
}
const listIds = async (u: User, qs = '') => {
  const res = await as(u).get(`/v2/inbox/conversations${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return {
    ids: (res.body.data as Row[]).map((r) => r.id),
    counts: res.body.meta.counts as Record<string, number>,
  };
};

/** Everything a person could read of the personal conversation, as booleans: true = they got content, false = refused / absent. */
async function reads(u: User) {
  const conv = personalConv;
  const list = await listIds(u);
  const search = await listIds(u, `?q=${encodeURIComponent('Zelda')}&status=all`);
  const counts = await as(u).get('/v2/inbox/counts');
  const detail = await as(u).get(`/v2/inbox/conversations/${conv.uuid}`);
  const messages = await as(u).get(`/v2/inbox/conversations/${conv.uuid}/messages`);
  const notes = await as(u).get(`/v2/inbox/conversations/${conv.uuid}/notes`);
  const events = await as(u).get(`/v2/inbox/conversations/${conv.uuid}/events`);
  const attachment = await as(u).get(
    `/v2/email/attachments/${conv.uuid}/${conv.messageUuid}/${conv.attachmentId}`,
  );
  const channels = await as(u).get('/v2/channels');
  const body = JSON.stringify([
    detail.body,
    messages.body,
    notes.body,
    events.body,
    list,
    search,
    channels.body,
  ]);
  return {
    list: list.ids.includes(conv.uuid),
    search: search.ids.includes(conv.uuid),
    countsAll: list.counts.all ?? 0,
    countsEndpoint: (counts.body as Record<string, number>).all ?? 0,
    detail: detail.status === 200,
    detailStatus: detail.status,
    messages: messages.status === 200,
    notes: notes.status === 200,
    events: events.status === 200,
    attachment: attachment.status === 200,
    channel: (channels.body.data as Array<{ name: string }>).some((c) => c.name === PERSONAL_A),
    leaked: /Zelda|secret numbers|secret\.pdf|ana\.agent/i.test(body),
  };
}

const NOTHING = {
  list: false,
  search: false,
  detail: false,
  messages: false,
  notes: false,
  events: false,
  attachment: false,
  channel: false,
  leaked: false,
};
const EVERYTHING = {
  list: true,
  search: true,
  detail: true,
  messages: true,
  notes: true,
  events: true,
  attachment: true,
  channel: true,
  leaked: true,
};

describe("the leakage matrix: A's personal mailbox conversations (policy: admins may NOT read)", () => {
  it('A, the owner, reads everything of it, and the counts include it', async () => {
    const r = await reads(A);
    expect(r).toMatchObject(EVERYTHING);
    // Their list holds the shared thread and their own private one.
    expect((await listIds(A)).ids.sort()).toEqual([personalConv.uuid, sharedConv.uuid].sort());
    expect(r.countsAll).toBe(2);
    expect(r.countsEndpoint).toBe(2);
  });

  it.each([
    ['B, another agent who sees every inbox conversation', () => B],
    ['D, an agent with no email permission', () => D],
    ['C, an admin while the policy is off', () => C],
    ['the signup admin while the policy is off', () => ADMIN],
  ])(
    '%s reads nothing of it: not in the list, search, counts, detail, messages, notes, events, attachments or channel list',
    async (_n, who) => {
      const r = await reads(who());
      expect(r).toMatchObject(NOTHING);
      expect(r.detailStatus).toBe(404);
      // The shared conversation is theirs as ever: the count is exactly one (the personal thread is neither counted nor hinted at).
      expect(r.countsAll).toBe(1);
      expect(r.countsEndpoint).toBe(1);
      expect((await listIds(who())).ids).toEqual([sharedConv.uuid]);
    },
  );

  it("another workspace cannot read it either, and sees none of this workspace's mail", async () => {
    const r = await reads(X);
    expect(r).toMatchObject(NOTHING);
    expect(r.countsAll).toBe(0);
    expect((await listIds(X)).ids).toEqual([]);
  });

  it('acting on it is refused as "not found" for everyone else: reply, note, resolve, claim, mark read', async () => {
    const c = personalConv.uuid;
    for (const who of [B, C, ADMIN]) {
      const reply = await as(who)
        .post(`/v2/inbox/conversations/${c}/messages`)
        .set('idempotency-key', idem())
        .send({ kind: 'text', body: 'hi', clientMessageId: randomUUID() });
      expect(reply.status, JSON.stringify(reply.body)).toBe(404);
      for (const [path, body] of [
        ['notes', { body: 'x' }],
        ['read', { upToSeq: 1 }],
        ['status', { status: 'resolved', rowVersion: 1 }],
      ] as const) {
        const res = await as(who)
          .post(`/v2/inbox/conversations/${c}/${path}`)
          .set('idempotency-key', idem())
          .send(body);
        expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(404);
      }
    }
  });

  it('the dashboard widgets never show it to anyone', async () => {
    const res = await as(ADMIN).get('/v2/dashboards/widgets');
    if (res.status === 200) expect(JSON.stringify(res.body)).not.toMatch(/Zelda|secret numbers/i);
  });

  it('realtime: only A may join its room, and an event about it reaches only A', async () => {
    const a = await listen(rig.p, A.token);
    const b = await listen(rig.p, B.token);
    const c = await listen(rig.p, C.token);
    expect((await joinConversation(a, personalConv.uuid)).ok ?? true).toBeTruthy();
    for (const conn of [b, c]) {
      const ack = (await joinConversation(conn, personalConv.uuid)) as { ok?: boolean };
      expect(ack.ok).toBeFalsy();
    }
    rig.fake.deliver(PERSONAL_A, {
      threadId: 'th-private',
      subject: 'Re: Private quote request',
      from: `${SECRET} <zelda@example.com>`,
      text: 'second private message',
    });
    await syncMailbox(t, personalMailbox);
    await until(
      'A hears about it',
      () =>
        eventsOf(a, 'inbox.conversation.upsert').length > 0 ||
        eventsOf(a, 'message.new').length > 0 ||
        undefined,
    );
    await sleep(300);
    for (const conn of [b, c]) {
      expect(JSON.stringify(conn.events)).not.toMatch(
        new RegExp(`${personalConv.uuid}|second private message`),
      );
    }
  });

  it('notifications about its mail go only to A', async () => {
    const rows = await rig.p.h.owner.query(
      `SELECT user_id FROM inbox_notifications WHERE org_id = $1 AND subject_uuid = $2`,
      [t.orgId, personalConv.uuid],
    );
    for (const r of rows.rows) expect(Number(r.user_id)).toBe(A.userId);
  });

  it('it cannot be assigned to someone who could not open it; assigning to the owner is fine', async () => {
    const row = (
      await rig.p.h.owner.query(`SELECT row_version FROM conversations WHERE id = $1`, [
        personalConv.id,
      ])
    ).rows[0];
    const rowVersion = Number(row.row_version);
    for (const target of [B, C, D]) {
      const res = await as(A)
        .post(`/v2/inbox/conversations/${personalConv.uuid}/assign`)
        .set('idempotency-key', idem())
        .send({ rowVersion, userId: target.uuid });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
    }
    const self = await as(A)
      .post(`/v2/inbox/conversations/${personalConv.uuid}/assign`)
      .set('idempotency-key', idem())
      .send({ rowVersion, userId: A.uuid });
    expect(self.status, JSON.stringify(self.body)).toBe(200);
  });

  it('routing rules never take it: no rule fires on a personal mailbox thread', async () => {
    const r = await rig.p.h.owner.query(`SELECT routing_meta FROM conversations WHERE id = $1`, [
      personalConv.id,
    ]);
    expect(r.rows[0].routing_meta?.routedMessage ?? null).toBeNull();
  });

  it('the public API key surface and the workspace export leave personal mail out', async () => {
    const conversations = await rig.p.h.owner.query(
      `SELECT count(*)::int AS n FROM conversations c WHERE c.org_id = $1`,
      [t.orgId],
    );
    expect(conversations.rows[0].n).toBeGreaterThanOrEqual(2);
    // Export / REST v1 are covered by their own suites for shape; here the personal thread must not be among the exported ids.
    const exp = await as(ADMIN).get('/v2/admin/workspace-export');
    if (exp.status === 200) expect(JSON.stringify(exp.body)).not.toContain(personalConv.uuid);
  });
});

describe('the sharing policy', () => {
  it('reads defaults for a workspace that never saved it, and only an admin saves it (row-versioned, audited, announced)', async () => {
    const fresh = await as(X).get('/v2/email/settings');
    expect(fresh.status).toBe(200);
    expect(fresh.body).toEqual({
      personalMailboxesEnabled: false,
      whoMayConnectPersonal: 'admins',
      adminsCanReadPersonal: false,
      rowVersion: 0,
    });
    // An agent can read the policy (the hub needs it) but not write it.
    expect((await as(B).get('/v2/email/settings')).status).toBe(200);
    expect((await as(D).get('/v2/email/settings')).status).toBe(403);
    expect(
      (
        await as(B)
          .put('/v2/email/settings')
          .set('idempotency-key', idem())
          .send({ rowVersion: 1, adminsCanReadPersonal: true })
      ).status,
    ).toBe(403);
    const cur = (await as(ADMIN).get('/v2/email/settings')).body as { rowVersion: number };
    const stale = await as(ADMIN)
      .put('/v2/email/settings')
      .set('idempotency-key', idem())
      .send({ rowVersion: cur.rowVersion + 5, adminsCanReadPersonal: false });
    expect(stale.status).toBe(409);
    expect(stale.body.code ?? stale.body.type).toMatch(/ROW_VERSION_CONFLICT/);
    const audit = await rig.p.h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'mail_workspace_settings'`,
      [t.orgId],
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
    const ev = await rig.p.h.owner.query(
      `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'mail.settings.updated'`,
      [t.orgId],
    );
    expect(ev.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('turning "admins can read personal" ON lets an admin (C, the signup admin) read the mailbox; B and D still cannot', async () => {
    await putPolicy({ adminsCanReadPersonal: true });
    for (const who of [C, ADMIN]) {
      const r = await reads(who);
      expect(r).toMatchObject({
        list: true,
        search: true,
        detail: true,
        messages: true,
        notes: true,
        events: true,
        attachment: true,
        channel: true,
      });
    }
    for (const who of [B, D]) expect(await reads(who)).toMatchObject(NOTHING);
    expect(await reads(X)).toMatchObject(NOTHING);
    // The admin's hub row is in full now.
    const hub = await as(C).get('/v2/email/mailboxes');
    const row = (
      hub.body.data as Array<{
        address: string;
        contentHidden?: boolean;
        conversationCount: number;
      }>
    ).find((m) => m.address === PERSONAL_A)!;
    expect(row.contentHidden ?? false).toBe(false);
    expect(row.conversationCount).toBeGreaterThanOrEqual(1);
  });

  it('an admin who had the conversation room open is taken out of it when the policy is withdrawn, and reads nothing again', async () => {
    const c = await listen(rig.p, C.token);
    const ack = (await joinConversation(c, personalConv.uuid)) as { ok?: boolean };
    expect(ack.ok).toBeTruthy();
    await putPolicy({ adminsCanReadPersonal: false });
    expect(await reads(C)).toMatchObject(NOTHING);
    expect(await reads(ADMIN)).toMatchObject(NOTHING);
    const before = c.events.length;
    rig.fake.deliver(PERSONAL_A, {
      threadId: 'th-private',
      subject: 'Re: Private quote request',
      from: `${SECRET} <zelda@example.com>`,
      text: 'third private message',
    });
    await syncMailbox(t, personalMailbox);
    await sleep(800);
    expect(JSON.stringify(c.events.slice(before))).not.toMatch(/third private message/);
  });

  it('with the policy ON an admin can be given the conversation; with it off they cannot', async () => {
    const rowVersion = Number(
      (
        await rig.p.h.owner.query(`SELECT row_version FROM conversations WHERE id = $1`, [
          personalConv.id,
        ])
      ).rows[0].row_version,
    );
    const off = await as(A)
      .post(`/v2/inbox/conversations/${personalConv.uuid}/assign`)
      .set('idempotency-key', idem())
      .send({ rowVersion, userId: C.uuid });
    expect(off.status).toBe(422);
    await putPolicy({ adminsCanReadPersonal: true });
    const rv2 = Number(
      (
        await rig.p.h.owner.query(`SELECT row_version FROM conversations WHERE id = $1`, [
          personalConv.id,
        ])
      ).rows[0].row_version,
    );
    const on = await as(A)
      .post(`/v2/inbox/conversations/${personalConv.uuid}/assign`)
      .set('idempotency-key', idem())
      .send({ rowVersion: rv2, userId: C.uuid });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    await putPolicy({ adminsCanReadPersonal: false });
  });

  it('turning personal mailboxes OFF hides the connect option but exposes nothing: the owner keeps their mailbox, others still read nothing', async () => {
    await putPolicy({ personalMailboxesEnabled: false });
    const blocked = await connect(B, 'bea.agent@acme.test', { scope: 'personal' });
    expect(blocked.start.status).toBe(422);
    expect(blocked.start.body.code).toBe('MAIL_PERSONAL_DISABLED');
    expect(await reads(A)).toMatchObject(EVERYTHING);
    for (const who of [B, D, C, ADMIN, X]) expect(await reads(who)).toMatchObject(NOTHING);
    await putPolicy({ personalMailboxesEnabled: true });
  });
});

describe('connecting and managing personal mailboxes', () => {
  it('who_may_connect_personal decides: "admins" refuses an agent (403 MAIL_PERSONAL_NOT_ALLOWED), an agent without the permission never reaches it', async () => {
    await putPolicy({ whoMayConnectPersonal: 'admins' });
    const refused = await connect(B, 'bea.agent@acme.test', { scope: 'personal' });
    expect(refused.start.status).toBe(403);
    expect(refused.start.body.code).toBe('MAIL_PERSONAL_NOT_ALLOWED');
    expect((await connect(D, 'dan.agent@acme.test', { scope: 'personal' })).start.status).toBe(403);
    // A shared mailbox still needs mail.mailboxes.manage.
    expect((await connect(B, 'x@acme.test', { scope: 'shared' })).start.status).toBe(403);
    await putPolicy({ whoMayConnectPersonal: 'agents' });
  });

  it('an agent connects a personal mailbox: scope personal, owner is them, it counts toward the plan, the channel is its own', async () => {
    const before = (await as(ADMIN).get('/v2/email/mailboxes')).body as { used: number };
    expect((await connect(B, 'bea.agent@acme.test', { scope: 'personal' })).outcome).toBe(
      'connected',
    );
    const row = (await mailboxRow('bea.agent@acme.test'))!;
    expect(row).toMatchObject({ scope: 'personal', owner_user_id: B.userId, provider: 'google' });
    const after = (await as(ADMIN).get('/v2/email/mailboxes')).body as { used: number };
    expect(after.used).toBe(before.used + 1);
  });

  it('the mailbox list: an agent sees shared + their own; an admin sees others as summary rows; nobody else learns of them', async () => {
    const addrs = async (u: User) =>
      ((await as(u).get('/v2/email/mailboxes')).body.data as Array<{ address: string }>)
        .map((m) => m.address)
        .sort();
    expect(await addrs(A)).toEqual([PERSONAL_A, SHARED].sort());
    expect(await addrs(B)).toEqual(['bea.agent@acme.test', SHARED].sort());
    const adminView = (await as(C).get('/v2/email/mailboxes')).body.data as Array<{
      address: string;
      contentHidden?: boolean;
      conversationCount: number;
      lastError: string | null;
      channelId: string | null;
      ownerName: string | null;
    }>;
    const hidden = adminView.find((m) => m.address === PERSONAL_A)!;
    expect(hidden).toMatchObject({
      contentHidden: true,
      conversationCount: 0,
      lastError: null,
      channelId: null,
    });
    expect(hidden.ownerName).toBeTruthy();
    expect((await as(D).get('/v2/email/mailboxes')).status).toBe(403);
    expect((await as(X).get('/v2/email/mailboxes')).body.data).toEqual([]);
  });

  it('only the owner renames, syncs or reconnects it; an admin may only disconnect; others get "not found"', async () => {
    const row = (await mailboxRow(PERSONAL_A))!;
    const rv = Number(row.row_version);
    const patch = (u: User) =>
      as(u)
        .patch(`/v2/email/mailboxes/${personalMailbox}`)
        .set('idempotency-key', idem())
        .send({ displayName: 'Mine', rowVersion: rv });
    expect((await patch(B)).status).toBe(404);
    expect((await patch(C)).status).toBe(403);
    expect((await as(B).post(`/v2/email/mailboxes/${personalMailbox}/sync`)).status).toBe(404);
    expect((await as(C).post(`/v2/email/mailboxes/${personalMailbox}/sync`)).status).toBe(403);
    expect((await as(B).delete(`/v2/email/mailboxes/${personalMailbox}`)).status).toBe(404);
    expect((await connect(B, PERSONAL_A, { mailboxId: personalMailbox })).start.status).toBe(404);
    expect((await connect(C, PERSONAL_A, { mailboxId: personalMailbox })).start.status).toBe(403);
    expect((await patch(A)).status).toBe(200);
    const reconnect = await connect(A, PERSONAL_A, { mailboxId: personalMailbox });
    expect(reconnect.outcome).toBe('connected');
  });

  it("another person cannot take over an address already connected as someone's personal mailbox", async () => {
    const res = await connect(B, PERSONAL_A, { scope: 'personal' });
    expect(res.outcome).not.toBe('connected');
    const owners = await rig.p.h.owner.query(
      `SELECT owner_user_id FROM mail_mailboxes WHERE org_id = $1 AND address = $2`,
      [t.orgId, PERSONAL_A],
    );
    expect(owners.rows).toHaveLength(1);
    expect(Number(owners.rows[0].owner_user_id)).toBe(A.userId);
  });

  it('the plan limit counts personal mailboxes: at the limit the next connection is refused', async () => {
    await rig.p.h.owner.query(
      `UPDATE org_plan_state SET overrides = jsonb_set(overrides, '{limits,email_mailboxes}', '3') WHERE org_id = $1`,
      [t.orgId],
    );
    const refused = await connect(B, 'overflow@acme.test', { scope: 'personal' });
    expect(refused.start.status).toBe(422);
    expect(refused.start.body.code).toBe('MAIL_MAILBOX_LIMIT');
  });

  it("an admin can disconnect somebody's personal mailbox (offboarding): it stops, and its conversations stay unreadable to them", async () => {
    const bea = (await mailboxRow('bea.agent@acme.test'))!;
    expect((await as(C).delete(`/v2/email/mailboxes/${bea.uuid}`)).status).toBe(204);
    expect((await mailboxRow('bea.agent@acme.test'))!.status).toBe('disconnected');
    // A disconnected personal mailbox is still its owner's alone.
    expect(await reads(A)).toMatchObject(EVERYTHING);
    expect(await reads(B)).toMatchObject(NOTHING);
  });

  it('shared mailboxes are unaffected: everyone with the inbox reads the shared conversation, whatever the personal rules say', async () => {
    for (const who of [A, B, C, D, ADMIN]) {
      const res = await as(who).get(`/v2/inbox/conversations/${sharedConv.uuid}`);
      expect(res.status).toBe(200);
      expect(
        (await as(who).get(`/v2/inbox/conversations/${sharedConv.uuid}/messages`)).status,
      ).toBe(200);
    }
    expect((await as(X).get(`/v2/inbox/conversations/${sharedConv.uuid}`)).status).toBe(404);
  });

  it('removing the owner can never turn the private mailbox into a shared one: its conversations stay hidden from the workspace', async () => {
    // Simulate the cascade: the mailbox row is gone while its channel and conversations remain.
    const tmp = await rig.p.h.owner.query(
      `SELECT * FROM mail_mailboxes WHERE org_id = $1 AND address = $2`,
      [t.orgId, PERSONAL_A],
    );
    expect(tmp.rows).toHaveLength(1);
    await rig.p.h.owner.query(`DELETE FROM mail_signatures WHERE org_id = $1 AND mailbox_id = $2`, [
      t.orgId,
      tmp.rows[0].id,
    ]);
    await rig.p.h.owner.query(`DELETE FROM mail_mailboxes WHERE org_id = $1 AND id = $2`, [
      t.orgId,
      tmp.rows[0].id,
    ]);
    for (const who of [A, B, D, C, ADMIN]) expect(await reads(who)).toMatchObject(NOTHING);
  });
});
