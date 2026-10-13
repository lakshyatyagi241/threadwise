import { randomUUID } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 90_000 });
import { RequestContextStore } from '../../../src/common/context/request-context';
import { MailSyncService } from '../../../src/modules/channel-email/mail-sync.service';
import { until } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import { mailWorkspace, startMailRig, type MailRig } from './support';

/**
 * The IMAP + SMTP provider (TW-MAIL-031) against a REAL mail server: GreenMail (`greenmail/standalone`) in a container, through the real
 * driver, the real sync and the real inbox pipeline. Nothing here talks to a hosted mail provider.
 */
const ADDR = 'support@acme.test';
const PASS = 'secret-pass';
let rig: MailRig;
let t: Tenant;
let mail: StartedTestContainer;
let smtpPort = 0;
let imapPort = 0;
let imapsPort = 0;
let mailboxUuid = '';
let channelId = 0;
const savedEnv: Record<string, string | undefined> = {};

const as = (token = t.admin) => rig.p.api.as(token);
const sync = () =>
  RequestContextStore.run(
    {
      requestId: `spec-${randomUUID()}`,
      orgId: t.orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    () => rig.p.h.app.get(MailSyncService).sync(t.orgId, mailboxUuid),
  );
const conversations = async () =>
  (
    await rig.p.h.owner.query(
      `SELECT * FROM conversations WHERE org_id = $1 AND channel_id = $2 ORDER BY id`,
      [t.orgId, channelId],
    )
  ).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const messagesOf = async (conversationId: unknown) =>
  (
    await rig.p.h.owner.query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq`, [
      conversationId,
    ])
  ).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const mailboxRow = async () =>
  (
    await rig.p.h.owner.query(`SELECT * FROM mail_mailboxes WHERE org_id = $1 AND uuid = $2`, [
      t.orgId,
      mailboxUuid,
    ])
  ).rows[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A mail arrives at the mailbox the way real mail does: over SMTP to the server. */
async function deliver(o: {
  subject: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  from?: string;
  to?: string;
  text?: string;
  headers?: Record<string, string>;
  date?: Date;
}): Promise<string> {
  const messageId = o.messageId ?? `${randomUUID()}@example.com`;
  const transport = createTransport({ host: mail.getHost(), port: smtpPort, ignoreTLS: true });
  await transport.sendMail({
    from: o.from ?? 'Ana Customer <ana@example.com>',
    to: o.to ?? ADDR,
    subject: o.subject,
    text: o.text ?? 'Hello from a customer',
    messageId: `<${messageId}>`,
    ...(o.inReplyTo ? { inReplyTo: `<${o.inReplyTo}>` } : {}),
    ...(o.references ? { references: o.references.split(' ').map((r) => `<${r}>`) } : {}),
    headers: o.headers ?? {},
    ...(o.date ? { date: o.date } : {}),
  });
  transport.close();
  return messageId;
}

const body = (over: Record<string, unknown> = {}) => ({
  scope: 'shared',
  address: ADDR,
  displayName: 'Acme Support',
  imap: {
    host: mail.getHost(),
    port: imapPort,
    security: 'none',
    username: 'support',
    password: PASS,
  },
  smtp: { host: mail.getHost(), port: smtpPort, security: 'none' },
  ...over,
});

beforeAll(async () => {
  mail = await new GenericContainer('greenmail/standalone:2.1.3')
    .withExposedPorts(3025, 3143, 3993)
    .withEnvironment({
      GREENMAIL_OPTS: `-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=support:${PASS}@acme.test`,
    })
    .withWaitStrategy(Wait.forLogMessage(/Starting GreenMail standalone/))
    .start();
  smtpPort = mail.getMappedPort(3025);
  imapPort = mail.getMappedPort(3143);
  imapsPort = mail.getMappedPort(3993);
  await new Promise((r) => setTimeout(r, 3000));
  for (const k of ['MAIL_IMAP_ALLOW_PRIVATE_HOSTS', 'MAIL_IMAP_TIMEOUT_MS'])
    savedEnv[k] = process.env[k];
  process.env.MAIL_IMAP_ALLOW_PRIVATE_HOSTS = 'true';
  process.env.MAIL_IMAP_TIMEOUT_MS = '8000';
  rig = await startMailRig();
  t = await mailWorkspace(rig.p, 'imap');
}, 300_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rig?.restore();
  await mail?.stop();
});

describe('TW-MAIL-031: connecting an IMAP/SMTP mailbox', () => {
  it('lists IMAP as an always-ready provider', async () => {
    const res = await as().get('/v2/email/providers');
    expect(res.status).toBe(200);
    expect(res.body.data.find((p: { provider: string }) => p.provider === 'imap')).toMatchObject({
      kind: 'password',
      ready: true,
      notReadyReason: null,
    });
  });

  it('a wrong IMAP password is refused as an IMAP failure and nothing is stored', async () => {
    const res = await as()
      .post('/v2/email/mailboxes/connect-imap')
      .send(body({ imap: { ...body().imap, password: 'nope' } }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MAIL_IMAP_AUTH_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('nope');
    const n = await rig.p.h.owner.query(
      `SELECT count(*)::int AS n FROM mail_mailboxes WHERE org_id = $1`,
      [t.orgId],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it('a wrong SMTP password (IMAP fine) is refused as an SMTP failure', async () => {
    const res = await as()
      .post('/v2/email/mailboxes/connect-imap')
      .send(body({ smtp: { ...body().smtp, username: 'support', password: 'wrong-smtp' } }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MAIL_SMTP_AUTH_FAILED');
  });

  it('a server that does not answer, and a certificate that cannot be verified, are refused as unreachable', async () => {
    const closed = await as()
      .post('/v2/email/mailboxes/connect-imap')
      .send(body({ imap: { ...body().imap, port: 1 } }));
    expect(closed.body.code).toBe('MAIL_IMAP_CONNECT_FAILED');
    // GreenMail's IMAPS uses a self-signed certificate: validation is always on, so it is refused.
    const selfSigned = await as()
      .post('/v2/email/mailboxes/connect-imap')
      .send(body({ imap: { ...body().imap, port: imapsPort, security: 'ssl' } }));
    expect(selfSigned.status).toBe(422);
    expect(selfSigned.body.code).toBe('MAIL_IMAP_CONNECT_FAILED');
  });

  it('refuses a private address when the platform does not allow private mail servers', async () => {
    process.env.MAIL_IMAP_ALLOW_PRIVATE_HOSTS = 'false';
    try {
      for (const host of ['127.0.0.1', 'localhost', '169.254.169.254', '10.0.0.5']) {
        const res = await as()
          .post('/v2/email/mailboxes/connect-imap')
          .send(body({ imap: { ...body().imap, host } }));
        expect(res.status, host).toBe(422);
        expect(res.body.code, host).toBe('MAIL_IMAP_CONNECT_FAILED');
        expect(res.body.detail ?? res.body.message ?? '', host).toMatch(/not allowed/i);
      }
    } finally {
      process.env.MAIL_IMAP_ALLOW_PRIVATE_HOSTS = 'true';
    }
  });

  it('connects with good credentials: the password is sealed and never returned, and a first sync is queued', async () => {
    await deliver({ subject: 'Before connect', date: new Date(Date.now() - 86_400_000) });
    const res = await as().post('/v2/email/mailboxes/connect-imap').send(body());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ provider: 'imap', address: ADDR, scope: 'shared' });
    expect(res.body.imap).toMatchObject({
      host: mail.getHost(),
      port: imapPort,
      security: 'none',
      username: 'support',
    });
    expect(JSON.stringify(res.body)).not.toContain(PASS);
    mailboxUuid = res.body.id as string;
    const row = await mailboxRow();
    expect(row.connection_enc).toMatch(/^v\d+:/);
    expect(JSON.stringify(row.connection_public)).not.toContain(PASS);
    expect(row.refresh_token_enc).toBeNull();
    channelId = Number(
      (await rig.p.h.owner.query(`SELECT id FROM channels WHERE uuid = $1`, [row.channel_uuid]))
        .rows[0].id,
    );
    await until('first sync by the worker', async () =>
      (await mailboxRow()).last_synced_at ? true : undefined,
    );
  });

  it('connecting the same address again is a reconnect of the same mailbox, never a second one', async () => {
    const again = await as().post('/v2/email/mailboxes/connect-imap').send(body());
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.id).toBe(mailboxUuid);
    const n = await rig.p.h.owner.query(
      `SELECT count(*)::int AS n FROM mail_mailboxes WHERE org_id = $1`,
      [t.orgId],
    );
    expect(n.rows[0].n).toBe(1);
  });
});

describe('TW-MAIL-031: syncing', () => {
  it('the first sync stored the earlier mail quietly and left a cursor', async () => {
    const convs = await conversations();
    expect(convs).toHaveLength(1);
    expect(convs[0]!.unread_count).toBe(0);
    const row = await mailboxRow();
    expect(row.sync_cursor).toMatchObject({
      uidValidity: expect.any(String),
      lastUid: expect.any(Number),
    });
    expect(row.last_error).toBeNull();
  });

  it('two mails of one thread land in ONE conversation; redelivery stores nothing twice', async () => {
    const first = await deliver({ subject: 'Order 7', text: 'Where is my order?' });
    await deliver({
      subject: 'Re: Order 7',
      inReplyTo: first,
      references: first,
      text: 'Any news?',
    });
    await sync();
    const convs = (await conversations()).filter(
      (c) => c.title === 'Order 7' || c.title === 'Re: Order 7',
    );
    expect(convs).toHaveLength(1);
    const msgs = await messagesOf(convs[0]!.id);
    expect(msgs.filter((m) => m.direction === 'in')).toHaveLength(2);
    expect(msgs[0]!.meta.historySync).not.toBe(true);
    expect(msgs.filter((m) => m.direction === 'in')).toHaveLength(2);
    // The same sync again finds nothing new.
    expect(await sync()).toMatchObject({ status: 'synced', stored: 0 });
    // The same Message-ID delivered again is not stored again.
    await deliver({ subject: 'Order 7', messageId: first });
    expect(await sync()).toMatchObject({ status: 'synced', stored: 0 });
    expect((await messagesOf(convs[0]!.id)).filter((m) => m.direction === 'in')).toHaveLength(2);
  });

  it('a mail with an attachment keeps its file; an auto-reply is marked automated', async () => {
    const transport = createTransport({ host: mail.getHost(), port: smtpPort, ignoreTLS: true });
    await transport.sendMail({
      from: 'ana@example.com',
      to: ADDR,
      subject: 'Invoice',
      text: 'See attached',
      attachments: [
        {
          filename: 'invoice.pdf',
          content: Buffer.from('%PDF-1.4 test'),
          contentType: 'application/pdf',
        },
      ],
    });
    transport.close();
    await deliver({ subject: 'Out of office', headers: { 'Auto-Submitted': 'auto-replied' } });
    await sync();
    const convs = await conversations();
    const invoice = convs.find((c) => c.title === 'Invoice')!;
    const [m] = await messagesOf(invoice.id);
    expect(m!.meta.email.attachments).toHaveLength(1);
    expect(m!.meta.email.attachments[0]).toMatchObject({ name: 'invoice.pdf', tooLarge: false });
    const ooo = convs.find((c) => c.title === 'Out of office')!;
    expect((await messagesOf(ooo.id))[0]!.meta.email.automated).toBe(true);
  });

  it('a UIDVALIDITY change triggers a quiet repair resync that stores nothing twice', async () => {
    const before = (
      await rig.p.h.owner.query(`SELECT count(*)::int AS n FROM messages WHERE org_id = $1`, [
        t.orgId,
      ])
    ).rows[0].n as number;
    await rig.p.h.owner.query(
      `UPDATE mail_mailboxes SET sync_cursor = jsonb_set(sync_cursor, '{uidValidity}', '"1"') WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, mailboxUuid],
    );
    const fresh = await deliver({ subject: 'After renumbering' });
    const result = await sync();
    expect(result).toMatchObject({ status: 'synced', mode: 'repair' });
    expect(fresh).toBeTruthy();
    const after = (
      await rig.p.h.owner.query(`SELECT count(*)::int AS n FROM messages WHERE org_id = $1`, [
        t.orgId,
      ])
    ).rows[0].n as number;
    // Only the one new mail was added; everything the repair re-read was already stored.
    expect(after).toBe(before + 1);
    const row = await mailboxRow();
    expect(row.sync_cursor.uidValidity).not.toBe('1');
    expect(row.sync_cursor.quietUntil).toBeUndefined();
  });

  it('a wrong stored password marks the mailbox as needing a reconnect', async () => {
    const saved = (await mailboxRow()).connection_enc as string;
    const { CryptoService } = await import('../../../src/common/crypto/crypto.service');
    const crypto = rig.p.h.app.get(CryptoService);
    const opened = JSON.parse(crypto.decrypt(saved)) as { login: { imap: { password: string } } };
    opened.login.imap.password = 'changed-on-server';
    await rig.p.h.owner.query(
      `UPDATE mail_mailboxes SET connection_enc = $3 WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, mailboxUuid, crypto.encrypt(JSON.stringify(opened))],
    );
    expect(await sync()).toMatchObject({ status: 'skipped', reason: 'needs_reauth' });
    expect((await mailboxRow()).status).toBe('needs_reauth');
    // Reconnecting with the right password (the owner re-enters it) restores it.
    const res = await as()
      .post('/v2/email/mailboxes/connect-imap')
      .send(body({ mailboxId: mailboxUuid }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await mailboxRow()).status).toBe('connected');
  });
});

describe('TW-MAIL-031: replying', () => {
  it('a reply leaves through SMTP, threads by headers, and the customer answering it joins the same conversation', async () => {
    const convs = await conversations();
    const conv = convs.find((c) => c.title === 'Order 7')!;
    const msgs = await messagesOf(conv.id);
    const newest = msgs.filter((m) => m.direction === 'in').at(-1)!.meta.email.messageId as string;
    const clientMessageId = randomUUID();
    const res = await as()
      .post(`/v2/inbox/conversations/${conv.uuid as string}/messages`)
      .send({
        kind: 'text',
        body: 'It ships today.',
        clientMessageId,
        email: { cc: ['boss@acme.test'] },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    await until('reply sent', async () => {
      const r = await rig.p.h.owner.query(`SELECT status FROM messages WHERE uuid = $1`, [
        res.body.id,
      ]);
      return r.rows[0]?.status === 'sent' ? true : undefined;
    });

    // The recipient's mailbox on the server holds the reply with the threading headers.
    const reader = new ImapFlow({
      host: mail.getHost(),
      port: imapPort,
      secure: false,
      doSTARTTLS: false,
      auth: { user: 'ana@example.com', pass: 'ana@example.com' },
      logger: false,
    });
    reader.on('error', () => undefined);
    await reader.connect();
    const lock = await reader.getMailboxLock('INBOX');
    let raw = '';
    try {
      for await (const m of reader.fetch('1:*', { source: true })) {
        const s = m.source!.toString();
        if (s.includes('It ships today.')) raw = s;
      }
    } finally {
      lock.release();
      await reader.logout();
    }
    const head = raw.split(/\r?\n\r?\n/)[0]!.replace(/\r?\n[ \t]+/g, ' ');
    const h = (n: string) => new RegExp(`^${n}: (.*)$`, 'im').exec(head)?.[1];
    expect(raw, 'the reply reached the recipient').not.toBe('');
    expect(h('Message-ID')).toBe(`<tw.${clientMessageId}@acme.test>`);
    expect(h('In-Reply-To')).toBe(`<${newest}>`);
    expect(h('References')).toContain(`<${newest}>`);
    expect(h('Cc')).toContain('boss@acme.test');
    expect(h('From')).toContain(ADDR);

    // The customer answers it: References carries our Message-ID, the conversation is the same one.
    await deliver({
      subject: 'Re: Order 7',
      inReplyTo: `tw.${clientMessageId}@acme.test`,
      references: `${newest} tw.${clientMessageId}@acme.test`,
      text: 'Thanks!',
    });
    await sync();
    const after = (await conversations()).filter(
      (c) => c.title === 'Order 7' || c.title === 'Re: Order 7',
    );
    expect(after).toHaveLength(1);
    expect((await messagesOf(after[0]!.id)).filter((m) => m.direction === 'in')).toHaveLength(3);
  });
});
