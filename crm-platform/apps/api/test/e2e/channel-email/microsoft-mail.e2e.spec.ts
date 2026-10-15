import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { resolveThreadKey } from '../../../src/infra/providers/channel-email';
import { MailDriverRegistry } from '../../../src/modules/channel-email/drivers/mail-driver.registry';
import { MailTokens } from '../../../src/modules/channel-email/mail-tokens.service';
import { MailSyncService } from '../../../src/modules/channel-email/mail-sync.service';
import { EmailChannelAdapter } from '../../../src/modules/channel-email/email-channel.adapter';
import type { ChannelRuntime } from '../../../src/infra/providers/chat-conversations/channel.port';
import { startPipeline, until, type Pipeline } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import { STATE_KEY, WEB, mailWorkspace, outcomeOf } from './support';
import { deriveStateKey, newState, signState } from '../../../src/modules/channel-email/mail-state';
import { FakeGraph, MS_SCOPES, type GraphAccount } from './fake-graph';

/**
 * Microsoft 365 / Outlook through Microsoft Graph (TW-MAIL-034), end to end: the OAuth connect round trip, the Inbox delta sync with its quiet
 * backfill, repair and idempotence, threads by `conversationId`, attachments, a reply that is a Graph reply draft (so Exchange writes
 * In-Reply-To and References), a retry that finds the mail it already sent, refresh-token rotation, a grant Microsoft refuses and a 429.
 * Microsoft is a local stand-in written from its documentation (see fake-graph.ts): nothing here talks to a real tenant.
 */
const CALLBACK = '/v2/public/email/microsoft/callback';
const ADDR = 'support@contoso.test';
const SENDER = 'ana@example.com';
const ENV_KEYS = [
  'MICROSOFT_LOGIN_URL',
  'MICROSOFT_GRAPH_URL',
  'MICROSOFT_MAIL_CLIENT_ID',
  'MICROSOFT_MAIL_CLIENT_SECRET',
  'MICROSOFT_MAIL_TENANT',
  'MAIL_SYNC_MAX_MESSAGES',
];

let fake: FakeGraph;
let p: Pipeline;
let t: Tenant;
let mailboxUuid: string;
let channelUuid: string;
let channelId: number;
const saved: Record<string, string | undefined> = {};
let codeSeq = 0;
let account: GraphAccount;

const as = (token = t.admin) => p.api.as(token);
const key = (conversationId: string) => `t:${resolveThreadKey({ conversationId, messageId: 'x' })}`;
const sync = () =>
  RequestContextStore.run(
    {
      requestId: `spec-${randomUUID()}`,
      orgId: t.orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    () => p.h.app.get(MailSyncService).sync(t.orgId, mailboxUuid),
  );
const mailboxRow = async () =>
  (
    await p.h.owner.query(`SELECT * FROM mail_mailboxes WHERE org_id = $1 AND uuid = $2`, [
      t.orgId,
      mailboxUuid,
    ])
  ).rows[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const conversations = async (peerKey?: string) =>
  (
    await p.h.owner.query(
      `SELECT * FROM conversations WHERE org_id = $1 AND channel_id = $2 ${peerKey ? 'AND peer_key = $3' : ''} ORDER BY id`,
      peerKey ? [t.orgId, channelId, peerKey] : [t.orgId, channelId],
    )
  ).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const messagesOf = async (conversationId: unknown) =>
  (
    await p.h.owner.query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq`, [
      conversationId,
    ])
  ).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The admin presses Connect, Microsoft redirects back with a code. Returns where the callback sent the browser. */
async function connect(
  acc: GraphAccount,
  opts: { scope?: string; refresh?: boolean; mailboxId?: string } = {},
): Promise<string> {
  const start = await as()
    .post('/v2/email/mailboxes/connect')
    .send({
      provider: 'microsoft',
      returnTo: '/email',
      ...(opts.mailboxId ? { mailboxId: opts.mailboxId } : {}),
    });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const state = new URL(start.body.authorizeUrl as string).searchParams.get('state')!;
  const code = fake.grant(`code-${++codeSeq}`, acc, opts);
  const res = await request(p.h.app.getHttpServer())
    .get(CALLBACK)
    .query({ code, state })
    .redirects(0);
  expect(res.status).toBe(302);
  return res.headers.location as string;
}

/** Runs the real driver's send with the access the token service opens for the mailbox. */
const driverSend = (mail: Record<string, unknown>) =>
  RequestContextStore.run(
    {
      requestId: `spec-${randomUUID()}`,
      orgId: t.orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    () =>
      p.h.app.get(MailTokens).withAccess(t.orgId, mailboxUuid, (access, mailbox) =>
        p.h.app
          .get(MailDriverRegistry)
          .get('microsoft')
          .send({ orgId: t.orgId, mailbox, access }, {
            messageId: `tw.${randomUUID()}@contoso.test`,
            from: { name: 'Support', address: ADDR },
            to: ['ana@example.com'],
            cc: [],
            bcc: [],
            subject: 'Hello',
            text: 'Hi Ana',
            html: null,
            inReplyTo: null,
            references: [],
            threadKey: null,
            attachments: [],
            headers: {},
            attempt: 1,
            ...mail,
          } as never),
      ),
  );

beforeAll(async () => {
  fake = await FakeGraph.start();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, fake.env());
  p = await startPipeline(async () => [
    (await import('../../../src/modules/channel-email/channel-email-worker.module'))
      .ChannelEmailWorkerModule,
  ]);
  t = await mailWorkspace(p, 'msg', 3);
  account = fake.account(ADDR, 'Contoso Support');
  const day = 86_400_000;
  // Mail that was in the Inbox before the mailbox was connected.
  fake.deliver(ADDR, {
    conversationId: 'old-1',
    subject: 'Old question one',
    at: Date.now() - 2 * day,
  });
  fake.deliver(ADDR, {
    conversationId: 'old-2',
    subject: 'Old question two',
    at: Date.now() - day,
  });
  fake.deliver(ADDR, { conversationId: 'ancient', subject: 'Ancient', at: Date.now() - 30 * day });
  fake.deliver(ADDR, { conversationId: 'junk', subject: 'Buy now', folder: 'junkemail' });
  fake.deliver(ADDR, { conversationId: 'drafty', subject: 'Draft', isDraft: true });
  fake.deliver(ADDR, { conversationId: 'self', subject: 'We wrote this', from: ADDR });
  expect(outcomeOf(await connect(account))).toBe('connected');
  const row = (await p.h.owner.query(`SELECT * FROM mail_mailboxes WHERE org_id = $1`, [t.orgId]))
    .rows[0];
  mailboxUuid = row.uuid as string;
  channelUuid = row.channel_uuid as string;
  channelId = Number(
    (await p.h.owner.query(`SELECT id FROM channels WHERE uuid = $1`, [channelUuid])).rows[0].id,
  );
}, 300_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await p?.stop();
  await fake?.stop();
});

describe('TW-MAIL-034: connect Microsoft', () => {
  it('lists the provider as ready, and the connect route returns a consent URL on the identity platform with every scope and a signed state', async () => {
    const providers = await as().get('/v2/email/providers');
    expect(providers.status).toBe(200);
    expect(
      providers.body.data.find((x: { provider: string }) => x.provider === 'microsoft'),
    ).toMatchObject({
      kind: 'oauth',
      ready: true,
      notReadyReason: null,
    });
    const res = await as()
      .post('/v2/email/mailboxes/connect')
      .send({ provider: 'microsoft', returnTo: '/email' });
    expect(res.status).toBe(200);
    const url = new URL(res.body.authorizeUrl as string);
    expect(url.origin + url.pathname).toBe(`${fake.url}/login/common/oauth2/v2.0/authorize`);
    expect(url.searchParams.get('client_id')).toBe(fake.clientId);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')!.split(' ')).toEqual([
      'openid',
      'email',
      'offline_access',
      'Mail.Read',
      'Mail.Send',
      'User.Read',
    ]);
    expect(url.searchParams.get('redirect_uri')).toMatch(
      /\/v2\/public\/email\/microsoft\/callback$/,
    );
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('the callback stored a connected Microsoft mailbox with sealed tokens, and created its inbox channel', async () => {
    const row = await mailboxRow();
    expect(row).toMatchObject({
      provider: 'microsoft',
      scope: 'shared',
      address: ADDR,
      status: 'connected',
      account_sub: account.id,
      display_name: 'Contoso Support',
    });
    expect(String(row.refresh_token_enc)).toMatch(/^v\d+:/);
    expect(String(row.scopes).split(' ')).toEqual(
      expect.arrayContaining(['Mail.Read', 'Mail.Send']),
    );
    expect(JSON.stringify(row)).not.toContain('rt-');
    const hub = await as().get('/v2/email/mailboxes');
    expect(hub.body.data[0]).toMatchObject({ provider: 'microsoft', address: ADDR });
    expect(JSON.stringify(hub.body)).not.toMatch(/rt-|at-/);
  });

  it('the tenant of the platform app is part of the authority', async () => {
    process.env.MICROSOFT_MAIL_TENANT = 'contoso-tenant-id';
    try {
      const res = await as()
        .post('/v2/email/mailboxes/connect')
        .send({ provider: 'microsoft', returnTo: '/email' });
      expect(new URL(res.body.authorizeUrl as string).pathname).toBe(
        '/login/contoso-tenant-id/oauth2/v2.0/authorize',
      );
    } finally {
      delete process.env.MICROSOFT_MAIL_TENANT;
    }
  });

  it('a different account on a reconnect is refused (wrong_account) and nothing changes', async () => {
    const other = fake.account('someone@else.test');
    const before = await mailboxRow();
    expect(outcomeOf(await connect(other, { mailboxId: mailboxUuid }))).toBe('wrong_account');
    expect(await mailboxRow()).toMatchObject({
      refresh_token_enc: before.refresh_token_enc,
      address: ADDR,
    });
  });

  it('a grant without Mail.Send, a missing refresh token, a denial and a forged state each end without storing anything', async () => {
    const fresh = fake.account('sales@contoso.test');
    expect(outcomeOf(await connect(fresh, { scope: 'Mail.Read User.Read openid email' }))).toBe(
      'missing_scope',
    );
    expect(outcomeOf(await connect(fresh, { refresh: false }))).toBe('failed');
    const denied = await request(p.h.app.getHttpServer())
      .get(CALLBACK)
      .query({
        error: 'access_denied',
        state: signState(
          newState(
            { orgId: t.orgId, userId: null, returnTo: '/email', provider: 'microsoft' },
            Date.now(),
          ),
          STATE_KEY,
        ),
      })
      .redirects(0);
    expect(outcomeOf(denied.headers.location as string)).toBe('denied');
    const forged = await request(p.h.app.getHttpServer())
      .get(CALLBACK)
      .query({ code: 'x', state: 'nonsense' })
      .redirects(0);
    expect(outcomeOf(forged.headers.location as string)).toBe('failed');
    // A state minted for Google is refused on the Microsoft callback.
    const googleState = signState(
      newState(
        { orgId: t.orgId, userId: null, returnTo: '/email', provider: 'google' },
        Date.now(),
      ),
      deriveStateKey(Buffer.alloc(32, 7).toString('base64')),
    );
    const wrong = await request(p.h.app.getHttpServer())
      .get(CALLBACK)
      .query({ code: 'x', state: googleState })
      .redirects(0);
    expect(new URL(wrong.headers.location as string, WEB).searchParams.get('email')).toBe('failed');
    const rows = await p.h.owner.query(`SELECT address FROM mail_mailboxes WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(rows.rows.map((r) => r.address)).toEqual([ADDR]);
  });

  it('without a platform Microsoft app the provider is not ready and connecting says so', async () => {
    const id = process.env.MICROSOFT_MAIL_CLIENT_ID;
    delete process.env.MICROSOFT_MAIL_CLIENT_ID;
    try {
      const providers = await as().get('/v2/email/providers');
      expect(
        providers.body.data.find((x: { provider: string }) => x.provider === 'microsoft'),
      ).toMatchObject({
        ready: false,
      });
      const res = await as()
        .post('/v2/email/mailboxes/connect')
        .send({ provider: 'microsoft', returnTo: '/email' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    } finally {
      process.env.MICROSOFT_MAIL_CLIENT_ID = id;
    }
  });
});

describe('TW-MAIL-034: the first sync is a quiet backfill of the Inbox', () => {
  it('stores the last days as history: nothing from junk, drafts, the mailbox itself or last month; a delta link is kept', async () => {
    await until('first sync by the worker', async () =>
      (await mailboxRow()).last_synced_at ? true : undefined,
    );
    const convs = await conversations();
    expect(convs.map((c) => c.peer_key).sort()).toEqual([key('old-1'), key('old-2')].sort());
    for (const c of convs) {
      expect(c.unread_count).toBe(0);
      const [m] = await messagesOf(c.id);
      expect(m).toMatchObject({ direction: 'in', status: 'received' });
      expect(m.meta.historySync).toBe(true);
    }
    const row = await mailboxRow();
    expect(String((row.sync_cursor as { deltaLink?: string }).deltaLink)).toContain('$deltatoken=');
    expect(row.last_error).toBeNull();
  });
});

describe('TW-MAIL-034: live mail', () => {
  it('two mails of one Graph conversation are ONE conversation; the body, headers, recipients and sender come through', async () => {
    fake.deliver(ADDR, {
      conversationId: 'conv-order',
      subject: 'Order question',
      from: SENDER,
      fromName: 'Ana Customer',
      messageId: 'first@sender.example',
      html: '<p>Where is my <b>order</b>?</p>',
      cc: ['bob@example.com'],
    });
    fake.deliver(ADDR, {
      conversationId: 'conv-order',
      subject: 'RE: Order question',
      from: SENDER,
      messageId: 'second@sender.example',
      inReplyTo: 'first@sender.example',
      references: '<first@sender.example>',
      html: null,
      text: 'Hello? Anyone there?',
    });
    expect(await sync()).toMatchObject({ status: 'synced', mode: 'history', stored: 2, failed: 0 });
    const [conv] = await conversations(key('conv-order'));
    expect(conv).toMatchObject({ title: 'Order question', unread_count: 2, status: 'open' });
    const msgs = await messagesOf(conv!.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.meta.email).toMatchObject({
      subject: 'Order question',
      from: { name: 'Ana Customer', address: SENDER },
      cc: [{ name: null, address: 'bob@example.com' }],
      messageId: 'first@sender.example',
      automated: false,
    });
    expect(msgs[0]!.body).toContain('Where is my order?');
    expect(msgs[1]!.body).toBe('Hello? Anyone there?');
    expect(msgs[1]!.meta.email).toMatchObject({
      inReplyTo: 'first@sender.example',
      references: ['first@sender.example'],
    });
  });

  it('a redelivery is harmless: a changed message in the delta and a second run store and download nothing', async () => {
    const first = fake.deliver(ADDR, {
      conversationId: 'conv-redo',
      subject: 'Once',
      messageId: 'redo@sender.example',
    });
    await sync();
    const gets = fake.count('GET', /\/me\/messages\/[^/]+$/);
    // Graph reports a changed (read) message again: the next delta lists it, and nothing is stored twice.
    fake.box(ADDR).log.push({ seq: ++fake.box(ADDR).seq, id: first, removed: false });
    expect(await sync()).toMatchObject({ status: 'synced', stored: 0, duplicates: 1 });
    expect(fake.count('GET', /\/me\/messages\/[^/]+$/)).toBe(gets);
    expect(await messagesOf((await conversations(key('conv-redo')))[0]!.id)).toHaveLength(1);
  });

  it('mail moved to junk or deleted afterwards is not stored; a draft and a self-sent mail are skipped', async () => {
    const gone = fake.deliver(ADDR, { conversationId: 'conv-gone', subject: 'Vanishing' });
    fake.moveOut(ADDR, gone, 'junkemail');
    fake.deliver(ADDR, { conversationId: 'conv-d', subject: 'Draft', isDraft: true });
    fake.deliver(ADDR, { conversationId: 'conv-s', subject: 'Self', from: ADDR });
    expect(await sync()).toMatchObject({ status: 'synced', stored: 0 });
    expect(await conversations(key('conv-gone'))).toHaveLength(0);
    expect(await conversations(key('conv-d'))).toHaveLength(0);
    expect(await conversations(key('conv-s'))).toHaveLength(0);
  });

  it('mail with Auto-Submitted or a List-Id is stored with automated: true', async () => {
    fake.deliver(ADDR, {
      conversationId: 'conv-auto',
      subject: 'Out of office',
      headers: [['Auto-Submitted', 'auto-replied']],
    });
    fake.deliver(ADDR, {
      conversationId: 'conv-list',
      subject: 'Newsletter',
      headers: [['List-Id', '<news.example.com>']],
    });
    await sync();
    for (const id of ['conv-auto', 'conv-list']) {
      const [m] = await messagesOf((await conversations(key(id)))[0]!.id);
      expect(m!.meta.email.automated).toBe(true);
    }
  });

  it('attachments are listed and stored, an inline image is served from the same route, an attached message is kept as .eml', async () => {
    fake.deliver(ADDR, {
      conversationId: 'conv-files',
      subject: 'Invoice attached',
      html: '<p>Logo: <img src="cid:logo1"></p>',
      attachments: [
        {
          name: 'invoice.pdf',
          mime: 'application/pdf',
          data: Buffer.from('%PDF-1.4 fake invoice body'),
        },
        {
          name: 'logo.png',
          mime: 'image/png',
          data: Buffer.from(
            '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6050000000049454e44ae426082',
            'hex',
          ),
          contentId: 'logo1',
          inline: true,
        },
        {
          name: 'original',
          mime: 'message/rfc822',
          data: Buffer.from('Message-ID: <orig@x>\r\n\r\nbody'),
          kind: 'item',
        },
      ],
    });
    await sync();
    const [conv] = await conversations(key('conv-files'));
    const [msg] = await messagesOf(conv!.id);
    const atts = msg!.meta.email.attachments as Array<{
      id: string;
      name: string;
      mime: string;
      inline: boolean;
      tooLarge: boolean;
    }>;
    const pdf = atts.find((a) => a.name === 'invoice.pdf')!;
    const logo = atts.find((a) => a.name === 'logo.png')!;
    const eml = atts.find((a) => a.name === 'original.eml')!;
    expect(pdf).toMatchObject({ mime: 'application/pdf', inline: false, tooLarge: false });
    expect(logo).toMatchObject({ mime: 'image/png', inline: true });
    expect(eml).toBeTruthy();
    expect(msg!.meta.email.html).toContain(`src="cid:${logo.id}"`);
    const url = (a: { id: string }) => `/v2/email/attachments/${conv!.uuid}/${msg!.uuid}/${a.id}`;
    const res = await as().get(url(pdf)).buffer(true);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body as Buffer).toString()).toBe('%PDF-1.4 fake invoice body');
    expect((await as().get(url(logo))).headers['content-type']).toBe('image/png');
  });

  it('a mail that only has an inline image (hasAttachments is false) still gets its image', async () => {
    fake.deliver(ADDR, {
      conversationId: 'conv-inline',
      subject: 'Inline only',
      html: '<p><img src="cid:pic"></p>',
      attachments: [
        {
          name: 'pic.png',
          mime: 'image/png',
          data: Buffer.from('89504e470d0a1a0a', 'hex'),
          contentId: 'pic',
          inline: true,
        },
      ],
    });
    await sync();
    const [msg] = await messagesOf((await conversations(key('conv-inline')))[0]!.id);
    expect((msg!.meta.email.attachments as unknown[]).length).toBe(1);
  });
});

describe('TW-MAIL-034: repair, batches and failures', () => {
  it('a delta token Graph no longer keeps (410) is repaired quietly and sync carries on from a new link', async () => {
    const before = (await mailboxRow()).sync_cursor as { deltaLink: string };
    fake.expireDelta(ADDR);
    fake.deliver(ADDR, { conversationId: 'conv-after-410', subject: 'After the gap' });
    const res = await sync();
    expect(res).toMatchObject({ status: 'synced', mode: 'repair', failed: 0 });
    const [conv] = await conversations(key('conv-after-410'));
    expect(conv).toBeTruthy();
    expect((await messagesOf(conv!.id))[0]!.meta.historySync).toBe(true);
    const after = (await mailboxRow()).sync_cursor as { deltaLink: string };
    expect(after.deltaLink).not.toBe(before.deltaLink);
    fake.deliver(ADDR, { conversationId: 'conv-live-again', subject: 'Live again' });
    expect(await sync()).toMatchObject({ mode: 'history', stored: 1 });
  });

  it('more pages than one run reads, and more new mail than one run stores, are both finished by the next runs', async () => {
    fake.pageSize = 2;
    process.env.MAIL_SYNC_MAX_MESSAGES = '3';
    try {
      for (let i = 0; i < 7; i += 1)
        fake.deliver(ADDR, { conversationId: `conv-bulk-${i}`, subject: `Bulk ${i}` });
      let guard = 0;
      let last = await sync();
      while ((last as { leftover?: boolean }).leftover && guard++ < 10) last = await sync();
      for (let i = 0; i < 7; i += 1)
        expect(await conversations(key(`conv-bulk-${i}`))).toHaveLength(1);
    } finally {
      fake.pageSize = 50;
      delete process.env.MAIL_SYNC_MAX_MESSAGES;
    }
  });

  it('a 429 with Retry-After is a rate limit that carries the wait, is shown on the mailbox and heals on the next run', async () => {
    fake.failNext('GET', /\/delta$/, 429, {
      headers: { 'retry-after': '7' },
      body: { error: { code: 'TooManyRequests', message: 'slow down' } },
    });
    await expect(sync()).rejects.toMatchObject({ kind: 'rate_limit', retryAfterSeconds: 7 });
    expect(await mailboxRow()).toMatchObject({ status: 'error' });
    expect(String((await mailboxRow()).last_error)).toMatch(/limiting requests/);
    expect(String((await mailboxRow()).last_error)).not.toMatch(/slow down|TooManyRequests/);
    expect(await sync()).toMatchObject({ status: 'synced' });
    expect(await mailboxRow()).toMatchObject({ status: 'connected', last_error: null });
  });

  it('a Graph outage (503) is retried by the queue and does not touch the cursor', async () => {
    const before = (await mailboxRow()).sync_cursor;
    fake.failNext('GET', /\/delta$/, 503, { headers: { 'retry-after': '1' } });
    await expect(sync()).rejects.toMatchObject({ kind: 'transient', retryAfterSeconds: 1 });
    expect((await mailboxRow()).sync_cursor).toEqual(before);
    await sync();
  });

  it('an expired access token is refreshed once and the call repeated; the rotated refresh token replaces the old one', async () => {
    const oldEnc = (await mailboxRow()).refresh_token_enc;
    const refreshes = fake.forms('refresh_token').length;
    fake.killAccessTokens(ADDR);
    await p.h.owner.query(
      `UPDATE mail_mailboxes SET access_token_expires_at = now() - interval '1 hour' WHERE uuid = $1`,
      [mailboxUuid],
    );
    fake.deliver(ADDR, { conversationId: 'conv-after-refresh', subject: 'After refresh' });
    expect(await sync()).toMatchObject({ status: 'synced', stored: 1 });
    expect(fake.forms('refresh_token').length).toBe(refreshes + 1);
    const newEnc = (await mailboxRow()).refresh_token_enc;
    expect(newEnc).not.toBe(oldEnc);
    // The next refresh presents the NEW token.
    const used = fake.forms('refresh_token').map((r) => r.body.refresh_token);
    fake.killAccessTokens(ADDR);
    await p.h.owner.query(
      `UPDATE mail_mailboxes SET access_token_expires_at = now() - interval '1 hour' WHERE uuid = $1`,
      [mailboxUuid],
    );
    await sync();
    const usedAfter = fake.forms('refresh_token').map((r) => r.body.refresh_token);
    expect(usedAfter.at(-1)).not.toBe(used.at(-1));
  });
});

describe('TW-MAIL-034: a reply from the inbox', () => {
  it('leaves as a Graph reply draft of the original (so In-Reply-To and References are written), with our Message-ID, cc, bcc and subject; idempotent on the client id', async () => {
    const [conv] = await conversations(key('conv-order'));
    const msgs = await messagesOf(conv!.id);
    const newest = msgs.at(-1)!.meta.email.messageId as string;
    const clientMessageId = randomUUID();
    const body = {
      kind: 'text',
      body: 'Your order ships today.',
      clientMessageId,
      email: { cc: ['boss@contoso.test'], bcc: ['audit@contoso.test'], subject: 'Your order' },
    };
    const res = await as()
      .post(`/v2/inbox/conversations/${conv!.uuid as string}/messages`)
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const out = await until('reply sent', async () => {
      const r = await p.h.owner.query(
        `SELECT status, provider_message_id FROM messages WHERE uuid = $1`,
        [res.body.id],
      );
      return r.rows[0]?.status === 'sent'
        ? (r.rows[0] as { provider_message_id: string })
        : undefined;
    });
    const mails = fake.sentTo(ADDR);
    expect(mails).toHaveLength(1);
    const m = mails[0]!.message;
    expect(out.provider_message_id).toBe(m.id);
    expect(m.conversationId).toBe('conv-order');
    expect(m.subject).toBe('Your order');
    expect(m.to).toEqual([SENDER]);
    expect(m.cc).toEqual(['boss@contoso.test']);
    expect(m.bcc).toEqual(['audit@contoso.test']);
    expect(m.internetMessageId).toBe(`<tw.${clientMessageId}@contoso.test>`);
    const header = (n: string) => m.headers.find((h) => h.name.toLowerCase() === n)?.value;
    expect(header('in-reply-to')).toBe(`<${newest}>`);
    expect(header('references')).toContain(`<${newest}>`);
    expect(header('message-id')).toBe(`<tw.${clientMessageId}@contoso.test>`);
    expect(m.body).toContain('Your order ships today.');
    expect(m.body).not.toContain('quoted:');
    // No draft is left in the Drafts folder.
    expect([...fake.box(ADDR).messages.values()].filter((x) => x.folder === 'drafts')).toHaveLength(
      0,
    );

    const again = await as()
      .post(`/v2/inbox/conversations/${conv!.uuid as string}/messages`)
      .send(body);
    expect(again.body.id).toBe(res.body.id);
    expect(fake.sentTo(ADDR)).toHaveLength(1);
  });

  it('the mail we sent is not imported as a new inbound message by the next sync', async () => {
    const [conv] = await conversations(key('conv-order'));
    const before = (await messagesOf(conv!.id)).length;
    await sync();
    expect(await messagesOf(conv!.id)).toHaveLength(before);
  });

  it('a retry after a lost answer finds the message in Sent Items instead of sending twice', async () => {
    const adapter = p.h.app.get(EmailChannelAdapter);
    const runtime = {
      orgId: t.orgId,
      uuid: channelUuid,
      kind: 'email',
      externalId: mailboxUuid,
    } as unknown as ChannelRuntime;
    const envelope = (attempt: number) => ({
      kind: 'text' as const,
      to: key('conv-heal'),
      clientReference: 'retry-ref-1',
      attempt,
      body: 'Following up',
      email: {
        to: ['ana@example.com'],
        cc: [],
        bcc: [],
        subject: 'Re: Healed',
        inReplyTo: null,
        references: [],
        threadId: 'c:conv-heal',
      },
    });
    const first = await adapter.send(runtime, envelope(1));
    const sentAfterFirst = fake.sentTo(ADDR).length;
    const retried = await adapter.send(runtime, envelope(2));
    expect(retried.providerMessageId).toBe(first.providerMessageId);
    expect(fake.sentTo(ADDR)).toHaveLength(sentAfterFirst);
  });

  it('a mail with no original to answer still goes out (as a new message) and a header Graph refuses is never sent', async () => {
    const result = await driverSend({
      inReplyTo: 'deleted@sender.example',
      references: ['deleted@sender.example'],
      headers: { 'X-Threadwise': '1', 'Auto-Submitted': 'auto-generated' },
    });
    const sent = fake.sent.find((s) => s.id === result.providerMessageId)!;
    expect(sent.message.headers.some((h) => h.name === 'X-Threadwise')).toBe(true);
    expect(sent.message.headers.some((h) => h.name === 'Auto-Submitted')).toBe(false);
  });

  it('attachments go out: a small file inline, a large one through an upload session, both in the sent mail', async () => {
    const big = Buffer.alloc(4 * 1024 * 1024 + 123, 7);
    const small = Buffer.from('small file body');
    const result = await driverSend({
      html: '<p>See <b>files</b></p>',
      attachments: [
        { name: 'small.txt', mime: 'text/plain', bytes: small, objectKey: null },
        { name: 'big.bin', mime: 'application/octet-stream', bytes: big, objectKey: null },
      ],
    });
    const sent = fake.sent.find((s) => s.id === result.providerMessageId)!.message;
    expect(sent.bodyType).toBe('html');
    expect(sent.attachments.map((a) => a.name)).toEqual(['small.txt', 'big.bin']);
    expect(sent.attachments[0]!.data.equals(small)).toBe(true);
    expect(sent.attachments[1]!.data.equals(big)).toBe(true);
    expect(fake.count('POST', /createUploadSession$/)).toBeGreaterThanOrEqual(1);
  });

  it('Microsoft refusing a send ends as a refusal with our words, never Microsoft’s; an outage is a retryable failure and leaves no draft', async () => {
    fake.failNext('POST', /\/send$/, 403, {
      body: { error: { code: 'ErrorAccessDenied', message: 'SECRET PROVIDER TEXT' } },
    });
    await expect(driverSend({})).rejects.toMatchObject({ kind: 'forbidden', needsReauth: true });
    fake.failNext('POST', /\/send$/, 403, {
      body: { error: { code: 'ErrorAccessDenied', message: 'SECRET PROVIDER TEXT' } },
    });
    await driverSend({}).catch((e: Error) =>
      expect(e.message).not.toMatch(/SECRET|ErrorAccessDenied/),
    );
    fake.failNext('POST', /createDraft|\/me\/messages$/, 503, { headers: { 'retry-after': '3' } });
    await expect(driverSend({})).rejects.toMatchObject({
      kind: 'transient',
      retryable: true,
      retryAfterSeconds: 3,
    });
    fake.failNext('POST', /\/send$/, 429, { headers: { 'retry-after': '9' } });
    await expect(driverSend({})).rejects.toMatchObject({
      kind: 'rate_limit',
      retryAfterSeconds: 9,
    });
    fake.clearFailures();
  });
});

describe('TW-MAIL-034: a grant Microsoft refuses', () => {
  it('invalid_grant (AADSTS700082) marks the mailbox needs_reauth once, stops sync, and a reconnect heals it', async () => {
    fake.revokeGrant(ADDR);
    await p.h.owner.query(
      `UPDATE mail_mailboxes SET access_token_expires_at = now() - interval '1 hour' WHERE uuid = $1`,
      [mailboxUuid],
    );
    expect(await sync()).toEqual({ status: 'skipped', reason: 'needs_reauth' });
    const row = await mailboxRow();
    expect(row.status).toBe('needs_reauth');
    expect(String(row.last_error)).toMatch(/Reconnect it/);
    expect(String(row.last_error)).not.toMatch(/inactivity/);
    const events = await p.h.owner.query(
      `SELECT event_type FROM event_outbox WHERE org_id = $1 AND event_type = 'mail.mailbox.needs_reauth'`,
      [t.orgId],
    );
    expect(events.rows).toHaveLength(1);
    const calls = fake.requests.length;
    expect(await sync()).toEqual({ status: 'skipped', reason: 'needs_reauth' });
    expect(fake.requests.length).toBe(calls);

    expect(outcomeOf(await connect(account, { mailboxId: mailboxUuid }))).toBe('connected');
    expect(await mailboxRow()).toMatchObject({ status: 'connected', last_error: null });
    fake.deliver(ADDR, { conversationId: 'conv-back', subject: 'Back again' });
    expect(await sync()).toMatchObject({ status: 'synced' });
    expect(await conversations(key('conv-back'))).toHaveLength(1);
  });

  it('a wrong platform secret (AADSTS7000215) is the platform’s problem: the mailbox is not marked needs_reauth', async () => {
    const secret = process.env.MICROSOFT_MAIL_CLIENT_SECRET;
    process.env.MICROSOFT_MAIL_CLIENT_SECRET = 'wrong';
    await p.h.owner.query(
      `UPDATE mail_mailboxes SET access_token_expires_at = now() - interval '1 hour' WHERE uuid = $1`,
      [mailboxUuid],
    );
    try {
      const res = await sync().catch((e: Error) => e);
      expect(res).not.toEqual({ status: 'skipped', reason: 'needs_reauth' });
      expect((await mailboxRow()).status).not.toBe('needs_reauth');
    } finally {
      process.env.MICROSOFT_MAIL_CLIENT_SECRET = secret;
    }
  });

  it('scopes come back in any case and with the Graph prefix without failing the connect', async () => {
    const acc = fake.account('case@contoso.test');
    expect(
      outcomeOf(
        await connect(acc, {
          scope:
            'https://graph.microsoft.com/mail.read https://graph.microsoft.com/Mail.Send user.read openid email offline_access',
        }),
      ),
    ).toBe('connected');
    expect(MS_SCOPES).toContain('Mail.Send');
  });
});
