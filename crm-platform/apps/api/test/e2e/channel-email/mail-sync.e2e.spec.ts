import { randomUUID } from 'node:crypto';
import { pngOfSize } from '../../support/images';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { ChannelAdapterRegistry } from '../../../src/modules/chat-conversations/channel-adapter.registry';
import { EmailChannelAdapter } from '../../../src/modules/channel-email/email-channel.adapter';
import { MailSyncService } from '../../../src/modules/channel-email/mail-sync.service';
import { MailSyncSweep } from '../../../src/modules/channel-email/mail-sync.sweep';
import { MailSyncPublisher } from '../../../src/modules/channel-email/mail-sync.publisher';
import {
  ChannelError,
  type ChannelRuntime,
} from '../../../src/infra/providers/chat-conversations/channel.port';
import { until } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import {
  connectMailbox,
  mailWorkspace,
  outcomeOf,
  setMailPlan,
  startMailRig,
  type MailRig,
} from './support';

/**
 * Mail in and mail out (TW-MAIL-021, 022, 025, 026, 028), end to end: a mailbox is synced from a Gmail stand-in through the real clients,
 * the real parse and the real inbox pipeline, and a reply typed in the inbox leaves through the real adapter as an RFC 5322 message.
 * Google is a local stand-in written from its documentation: nothing here talks to a real Gmail account.
 */
let rig: MailRig;
let t: Tenant;
let mailboxUuid: string;
let channelUuid: string;
let channelId: number;
let cursorAfterBackfill = '';
const ADDR = 'support@acme.test';
const SENDER = 'Ana Customer <ana@example.com>';

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
const mailboxRow = async () =>
  (
    await rig.p.h.owner.query(`SELECT * FROM mail_mailboxes WHERE org_id = $1 AND uuid = $2`, [
      t.orgId,
      mailboxUuid,
    ])
  ).rows[0] as Record<string, unknown>;
const conversations = async (thread?: string) =>
  (
    await rig.p.h.owner.query(
      `SELECT * FROM conversations WHERE org_id = $1 AND channel_id = $2 ${thread ? 'AND peer_key = $3' : ''} ORDER BY id`,
      thread ? [t.orgId, channelId, `t:${thread}`] : [t.orgId, channelId],
    )
  ).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const messagesOf = async (conversationId: unknown) =>
  (
    await rig.p.h.owner.query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq`, [
      conversationId,
    ])
  ).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const as = (token = t.admin) => rig.p.api.as(token);
const getCount = () => rig.fake.count('GET', /\/messages\/[^/]+$/);

beforeAll(async () => {
  rig = await startMailRig();
  t = await mailWorkspace(rig.p, 'msy');
  rig.fake.account(ADDR, 'Acme Support');
  // Mail that was in the INBOX before the mailbox was connected.
  rig.fake.deliver(ADDR, {
    threadId: 'old-1',
    subject: 'Old question one',
    at: Date.now() - 2 * 86_400_000,
  });
  rig.fake.deliver(ADDR, {
    threadId: 'old-2',
    subject: 'Old question two',
    at: Date.now() - 86_400_000,
  });
  rig.fake.deliver(ADDR, {
    threadId: 'old-too-old',
    subject: 'Ancient',
    at: Date.now() - 30 * 86_400_000,
  });
  rig.fake.deliver(ADDR, { threadId: 'spam-1', subject: 'Buy now', labels: ['INBOX', 'SPAM'] });
  rig.fake.deliver(ADDR, { threadId: 'draft-1', subject: 'Draft', labels: ['DRAFT'] });
  rig.fake.deliver(ADDR, {
    threadId: 'sent-1',
    subject: 'We wrote this',
    labels: ['SENT'],
    from: `Acme <${ADDR}>`,
  });
  const location = await connectMailbox(rig, t, rig.fake.account(ADDR, 'Acme Support'));
  expect(outcomeOf(location)).toBe('connected');
  const row = (
    await rig.p.h.owner.query(`SELECT * FROM mail_mailboxes WHERE org_id = $1`, [t.orgId])
  ).rows[0];
  mailboxUuid = row.uuid as string;
  channelUuid = row.channel_uuid as string;
  channelId = Number(
    (await rig.p.h.owner.query(`SELECT id FROM channels WHERE uuid = $1`, [channelUuid])).rows[0]
      .id,
  );
}, 300_000);

afterAll(async () => {
  await rig?.restore();
});

describe('TW-MAIL-021: the first sync is a quiet backfill', () => {
  it('stores the last days of the INBOX as history: no unread, no alerts, nothing from spam, drafts, sent mail or last month', async () => {
    // The connect callback queued a first sync in the worker; let it finish so this run is not racing it.
    await until('first sync by the worker', async () =>
      (await mailboxRow()).last_synced_at ? true : undefined,
    );
    const convs = await conversations();
    expect(convs.map((c) => c.peer_key).sort()).toEqual(['t:old-1', 't:old-2']);
    for (const c of convs) {
      expect(c.unread_count).toBe(0);
      const [m] = await messagesOf(c.id);
      expect(m).toMatchObject({ direction: 'in', status: 'received' });
      expect(m.meta.historySync).toBe(true);
      expect(m.meta.email.subject).toMatch(/^Old question/);
    }
    // The conversation is dated when the mail was really sent, not when it was imported.
    const [m1] = await messagesOf(convs.find((c) => c.peer_key === 't:old-1')!.id);
    expect(Date.now() - new Date(m1.created_at).getTime()).toBeGreaterThan(86_400_000);
    // No contact is created for imported history.
    expect(convs.every((c) => c.contact_id === null)).toBe(true);
    const row = await mailboxRow();
    cursorAfterBackfill = String((row.sync_cursor as { historyId?: string } | null)?.historyId);
    expect(row.sync_cursor).not.toBeNull();
    expect(row.last_error).toBeNull();
    const res = await as().get('/v2/email/mailboxes');
    expect(res.body.data[0]).toMatchObject({ status: 'connected', conversationCount: 2 });
  });
});

describe('TW-MAIL-025, 026: live mail', () => {
  it('two emails of one Gmail thread are ONE conversation, titled by the first subject, with the sender linked as a contact by email', async () => {
    rig.fake.deliver(ADDR, {
      threadId: 'th-order',
      subject: 'Order question',
      from: SENDER,
      messageId: 'first@sender.example',
      text: 'Where is my order?',
      html: '<p>Where is my <b>order</b>?</p><img src="https://track.example/p.gif">',
      cc: 'Bob <bob@example.com>',
    });
    rig.fake.deliver(ADDR, {
      threadId: 'th-order',
      subject: 'Re: Order question',
      from: SENDER,
      messageId: 'second@sender.example',
      inReplyTo: 'first@sender.example',
      references: '<first@sender.example>',
      text: 'Hello? Anyone there?',
    });
    expect(await sync()).toMatchObject({ status: 'synced', mode: 'history', stored: 2, failed: 0 });

    const [conv] = await conversations('th-order');
    expect(conv).toMatchObject({
      title: 'Order question',
      peer_name: 'Ana Customer',
      unread_count: 2,
      status: 'open',
    });
    expect(await conversations()).toHaveLength(3);
    const msgs = await messagesOf(conv!.id);
    expect(msgs.map((m) => m.body)).toEqual(['Where is my order?', 'Hello? Anyone there?']);
    expect(msgs[0]!.meta.historySync).toBeUndefined();
    expect(msgs[0]!.meta.email).toMatchObject({
      subject: 'Order question',
      from: { name: 'Ana Customer', address: 'ana@example.com' },
      to: [{ name: null, address: ADDR }],
      cc: [{ name: 'Bob', address: 'bob@example.com' }],
      messageId: 'first@sender.example',
      threadId: 'th-order',
      automated: false,
      htmlTruncated: false,
    });
    // The remote tracking image is not loaded: its address moved aside.
    expect(msgs[0]!.meta.email.html).toContain('data-remote-src="https://track.example/p.gif"');
    expect(msgs[0]!.meta.email.html).not.toMatch(/\ssrc=/);
    expect(msgs[1]!.meta.email).toMatchObject({
      inReplyTo: 'first@sender.example',
      references: ['first@sender.example'],
    });

    const contact = await rig.p.h.owner.query(
      `SELECT id, name FROM contacts WHERE org_id = $1 AND normalized_email = 'ana@example.com'`,
      [t.orgId],
    );
    expect(contact.rows).toHaveLength(1);
    expect(conv!.contact_id).toBe(contact.rows[0].id);
    expect(contact.rows[0].name).toBe('Ana Customer');

    // The thread API carries the email block and the sender.
    const api = await as().get(`/v2/inbox/conversations/${conv!.uuid as string}/messages`);
    expect(api.status).toBe(200);
    expect(api.body.data[0].email).toMatchObject({ subject: 'Order question' });
  });

  it('a reply on a resolved thread reopens it; a later mail from another sender joins the same conversation', async () => {
    const [conv] = await conversations('th-order');
    await rig.p.h.owner.query(
      `UPDATE conversations SET status = 'resolved', resolved_at = now() WHERE id = $1`,
      [conv!.id],
    );
    rig.fake.deliver(ADDR, {
      threadId: 'th-order',
      subject: 'Re: Order question',
      from: 'Bob <bob@example.com>',
      text: 'I am also waiting',
    });
    await sync();
    const [after] = await conversations('th-order');
    expect(after).toMatchObject({ status: 'open', title: 'Order question' });
    expect(await messagesOf(conv!.id)).toHaveLength(3);
    expect(await conversations()).toHaveLength(3);
  });

  it('a redelivery is harmless: the same history read again stores nothing and downloads nothing', async () => {
    const [conv] = await conversations('th-order');
    const before = (await messagesOf(conv!.id)).length;
    const fetched = getCount();
    // Rewind the cursor to just after the backfill: Gmail lists them again.
    await rig.p.h.owner.query(
      `UPDATE mail_mailboxes SET sync_cursor = jsonb_build_object('historyId', $2::text) WHERE org_id = $1`,
      [t.orgId, cursorAfterBackfill],
    );
    const res = await sync();
    expect(res).toMatchObject({ status: 'synced', stored: 0 });
    expect((res as { duplicates: number }).duplicates).toBeGreaterThanOrEqual(3);
    expect(await messagesOf(conv!.id)).toHaveLength(before);
    expect(getCount()).toBe(fetched);
  });

  it('mail with Auto-Submitted or a List-Id is stored with automated: true', async () => {
    rig.fake.deliver(ADDR, {
      threadId: 'th-auto',
      subject: 'Out of office',
      from: 'Ana <ana@example.com>',
      headers: [['Auto-Submitted', 'auto-replied']],
    });
    rig.fake.deliver(ADDR, {
      threadId: 'th-news',
      subject: 'Weekly news',
      from: 'News <news@shop.example>',
      headers: [['List-Id', '<news.shop.example>']],
    });
    rig.fake.deliver(ADDR, { threadId: 'th-human', subject: 'Hi', from: 'Cy <cy@example.com>' });
    await sync();
    const flag = async (thread: string) =>
      (await messagesOf((await conversations(thread))[0]!.id))[0]!.meta.email.automated;
    expect(await flag('th-auto')).toBe(true);
    expect(await flag('th-news')).toBe(true);
    expect(await flag('th-human')).toBe(false);
  });

  it('attachments are stored and downloaded through the conversation; an inline image is served from the same route', async () => {
    rig.fake.deliver(ADDR, {
      threadId: 'th-files',
      subject: 'Invoice attached',
      from: SENDER,
      text: 'See attached',
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
          data: pngOfSize(),
          contentId: 'logo1',
          inline: true,
        },
        {
          name: 'run.exe',
          mime: 'application/x-msdownload',
          data: Buffer.from([
            0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0xff, 0xff,
          ]),
        },
      ],
    });
    await sync();
    const [conv] = await conversations('th-files');
    const [msg] = await messagesOf(conv!.id);
    const atts = msg!.meta.email.attachments as Array<{
      id: string;
      name: string;
      mime: string;
      size: number;
      inline: boolean;
      tooLarge: boolean;
    }>;
    const pdf = atts.find((a) => a.name === 'invoice.pdf')!;
    const logo = atts.find((a) => a.name === 'logo.png')!;
    const exe = atts.find((a) => a.name === 'run.exe')!;
    expect(pdf).toMatchObject({ mime: 'application/pdf', inline: false, tooLarge: false });
    expect(logo).toMatchObject({ mime: 'image/png', inline: true, tooLarge: false });
    // A file the upload policy refuses is noted, not stored, and the mail is kept.
    expect(exe.tooLarge).toBe(true);
    // The HTML points the inline image at its attachment.
    expect(msg!.meta.email.html).toContain(`src="cid:${logo.id}"`);

    const url = (att: { id: string }, c = conv!, m = msg!) =>
      `/v2/email/attachments/${c.uuid}/${m.uuid}/${att.id}`;
    const res = await as().get(url(pdf)).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename\*=UTF-8''invoice\.pdf$/,
    );
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(Buffer.from(res.body as Buffer).toString()).toBe('%PDF-1.4 fake invoice body');

    const img = await as().get(url(logo)).buffer(true);
    expect(img.status).toBe(200);
    expect(img.headers['content-disposition']).toMatch(/^inline;/);
    expect(img.headers['content-type']).toBe('image/png');

    // Not stored, a made-up id, another message's id, and a path outside the workspace are all the same 404.
    expect((await as().get(url(exe))).status).toBe(404);
    expect(
      (await as().get(url({ id: Buffer.from('chat/999/x/y.pdf').toString('base64url') }))).status,
    ).toBe(404);
    const [other] = await conversations('th-order');
    const [otherMsg] = await messagesOf(other!.id);
    expect((await as().get(url(pdf, other!, otherMsg!))).status).toBe(404);
  });

  it('attachment access follows the conversation: another workspace and a person without read access get 404 or 403', async () => {
    const [conv] = await conversations('th-files');
    const [msg] = await messagesOf(conv!.id);
    const pdf = (msg!.meta.email.attachments as Array<{ id: string; name: string }>).find(
      (a) => a.name === 'invoice.pdf',
    )!;
    const path = `/v2/email/attachments/${conv!.uuid}/${msg!.uuid}/${pdf.id}`;
    const other = await mailWorkspace(rig.p, 'msz');
    expect((await as(other.admin).get(path)).status).toBe(404);
    const nobody = await rig.p.api.member(t, 'noread', [['record.contacts.read']]);
    expect((await as(nobody.token).get(path)).status).toBe(403);
    const own = await rig.p.api.member(t, 'ownonly', [['inbox.conversation.read', 'own']]);
    expect((await as(own.token).get(path)).status).toBe(404);
  });

  it('a file over the size cap is not stored and says so; the mail is kept', async () => {
    process.env.MAIL_ATTACHMENT_MAX_BYTES = '2048';
    try {
      rig.fake.deliver(ADDR, {
        threadId: 'th-big',
        subject: 'Big file',
        from: SENDER,
        attachments: [
          {
            name: 'big.pdf',
            mime: 'application/pdf',
            data: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5000, 1)]),
          },
        ],
      });
      await sync();
    } finally {
      delete process.env.MAIL_ATTACHMENT_MAX_BYTES;
    }
    const [conv] = await conversations('th-big');
    const [msg] = await messagesOf(conv!.id);
    expect(msg!.meta.email.attachments).toEqual([
      expect.objectContaining({ name: 'big.pdf', tooLarge: true, size: 5005 }),
    ]);
    expect(msg!.body).toBe('Hello');
  });
});

describe('TW-MAIL-021: repair and failures', () => {
  it('a cursor Gmail no longer keeps is repaired quietly and sync carries on from a new one', async () => {
    rig.fake.expireHistory(ADDR);
    rig.fake.deliver(ADDR, { threadId: 'th-gap', subject: 'During the gap', from: SENDER });
    const res = await sync();
    expect(res).toMatchObject({ status: 'synced', mode: 'repair', stored: 1 });
    const [conv] = await conversations('th-gap');
    expect(conv!.unread_count).toBe(0);
    expect((await messagesOf(conv!.id))[0]!.meta.historySync).toBe(true);
    // The next run is incremental again.
    rig.fake.deliver(ADDR, { threadId: 'th-after-gap', subject: 'After the gap', from: SENDER });
    expect(await sync()).toMatchObject({ mode: 'history', stored: 1 });
    expect((await conversations('th-after-gap'))[0]!.unread_count).toBe(1);
  });

  it('a Google outage is shown on the mailbox, retried, and heals on the next good run', async () => {
    rig.fake.failNext('GET', /\/users\/me\/history$/, 503, { times: 1 });
    await expect(sync()).rejects.toThrow();
    let row = await mailboxRow();
    expect(row.status).toBe('error');
    expect(row.last_error).toBe('Google did not answer. Syncing will retry shortly.');
    const hub = await as().get('/v2/email/mailboxes');
    expect(hub.body.data[0]).toMatchObject({
      status: 'error',
      lastError: 'Google did not answer. Syncing will retry shortly.',
    });
    rig.fake.deliver(ADDR, { threadId: 'th-heal', subject: 'Healed', from: SENDER });
    expect(await sync()).toMatchObject({ status: 'synced', stored: 1 });
    row = await mailboxRow();
    expect(row).toMatchObject({ status: 'connected', last_error: null });
  });

  it('an expired access token is refreshed once and the call repeated (a 401 is not a failure)', async () => {
    rig.fake.killAccessTokens(ADDR);
    rig.fake.deliver(ADDR, { threadId: 'th-401', subject: 'Token', from: SENDER });
    const refreshes = rig.fake.forms('refresh_token').length;
    expect(await sync()).toMatchObject({ status: 'synced', stored: 1 });
    expect(rig.fake.forms('refresh_token').length).toBe(refreshes + 1);
  });
});

describe('TW-MAIL-022: a reply from the inbox', () => {
  it('leaves through Gmail as a threaded RFC 5322 message with cc, bcc and subject, and is idempotent on the client id', async () => {
    const [conv] = await conversations('th-order');
    const msgs = await messagesOf(conv!.id);
    const newest = msgs.at(-1)!.meta.email.messageId as string;
    const clientMessageId = randomUUID();
    const body = {
      kind: 'text',
      body: 'Your order ships today.',
      clientMessageId,
      email: { cc: ['boss@acme.test'], bcc: ['audit@acme.test'], subject: 'Your order' },
    };
    const res = await as()
      .post(`/v2/inbox/conversations/${conv!.uuid as string}/messages`)
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const out = await until('reply sent', async () => {
      const r = await rig.p.h.owner.query(
        `SELECT status, provider_message_id FROM messages WHERE uuid = $1`,
        [res.body.id],
      );
      return r.rows[0]?.status === 'sent'
        ? (r.rows[0] as { provider_message_id: string })
        : undefined;
    });
    const mails = rig.fake.sentTo(ADDR);
    expect(mails).toHaveLength(1);
    const raw = mails[0]!.raw;
    const head = raw.split(/\r?\n\r?\n/)[0]!.replace(/\r?\n[ \t]+/g, ' ');
    const h = (n: string) => new RegExp(`^${n}: (.*)$`, 'im').exec(head)?.[1];
    expect(mails[0]!.threadId).toBe('th-order');
    expect(out.provider_message_id).toBe(mails[0]!.id);
    expect(h('From')).toBe(`Acme Support <${ADDR}>`);
    expect(h('To')).toBe('bob@example.com');
    expect(h('Cc')).toBe('boss@acme.test');
    expect(h('Bcc')).toBe('audit@acme.test');
    expect(h('Subject')).toBe('Your order');
    expect(h('In-Reply-To')).toBe(`<${newest}>`);
    expect(h('References')).toContain(`<${newest}>`);
    expect(h('Message-ID')).toBe(`<tw.${clientMessageId}@acme.test>`);
    expect(raw).toContain('Your order ships today.');

    const again = await as()
      .post(`/v2/inbox/conversations/${conv!.uuid as string}/messages`)
      .send(body);
    expect(again.body.id).toBe(res.body.id);
    expect(rig.fake.sentTo(ADDR)).toHaveLength(1);
  });

  it('the mail we sent is not imported as a new inbound message by the next sync', async () => {
    const [conv] = await conversations('th-order');
    const before = (await messagesOf(conv!.id)).length;
    await sync();
    expect(await messagesOf(conv!.id)).toHaveLength(before);
    expect((await messagesOf(conv!.id)).filter((m) => m.direction === 'in').length).toBe(3);
  });

  it('a retry after a lost answer finds the message it already sent instead of sending twice', async () => {
    const adapter = rig.p.h.app.get(EmailChannelAdapter);
    const runtime = {
      orgId: t.orgId,
      uuid: channelUuid,
      kind: 'email',
      externalId: mailboxUuid,
    } as unknown as ChannelRuntime;
    const envelope = (attempt: number) => ({
      kind: 'text' as const,
      to: 't:th-heal',
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
        threadId: 'th-heal',
      },
    });
    const first = await adapter.send(runtime, envelope(1));
    const sentAfterFirst = rig.fake.sentTo(ADDR).length;
    const retried = await adapter.send(runtime, envelope(2));
    expect(retried.providerMessageId).toBe(first.providerMessageId);
    expect(rig.fake.sentTo(ADDR)).toHaveLength(sentAfterFirst);
  });

  it('Google refusing a message ends as a refusal with our words, never Google’s', async () => {
    const adapter = rig.p.h.app.get(EmailChannelAdapter);
    const runtime = {
      orgId: t.orgId,
      uuid: channelUuid,
      kind: 'email',
      externalId: mailboxUuid,
    } as unknown as ChannelRuntime;
    const env = {
      kind: 'text' as const,
      to: 't:x',
      clientReference: 'refused-1',
      attempt: 1,
      body: 'x',
      email: {
        to: ['ana@example.com'],
        cc: [],
        bcc: [],
        subject: 's',
        inReplyTo: null,
        references: [],
        threadId: 'x',
      },
    };
    rig.fake.failNext('POST', /messages\/send$/, 400, {
      body: {
        error: {
          code: 400,
          message: 'Invalid To header RAW-GOOGLE-TEXT',
          errors: [{ reason: 'invalidArgument' }],
        },
      },
    });
    const refused = (await adapter.send(runtime, env).catch((e: unknown) => e)) as ChannelError;
    expect(refused).toBeInstanceOf(ChannelError);
    expect(refused).toMatchObject({ code: 'MAIL_SEND_REFUSED', retryable: false });
    expect(refused.message).not.toContain('RAW-GOOGLE-TEXT');
    rig.fake.failNext('POST', /messages\/send$/, 503, { times: 1 });
    const outage = (await adapter
      .send(runtime, { ...env, clientReference: 'outage-1' })
      .catch((e: unknown) => e)) as ChannelError;
    expect(outage).toMatchObject({ code: 'MAIL_SEND_FAILED', retryable: true });
    // Never anything but a ChannelError, whatever the input.
    const noThread = (await adapter
      .send(runtime, { ...env, email: undefined } as never)
      .catch((e: unknown) => e)) as ChannelError;
    expect(noThread).toMatchObject({ code: 'MAIL_NO_THREAD', retryable: false });
    const media = (await adapter
      .send(runtime, {
        kind: 'reaction',
        to: 'x',
        clientReference: 'r',
        attempt: 1,
        reaction: { providerMessageId: 'a', emoji: 'x' },
      } as never)
      .catch((e: unknown) => e)) as ChannelError;
    expect(media).toBeInstanceOf(ChannelError);
  });

  it('the adapter says what email can do and registers as the email channel', () => {
    const adapter = rig.p.h.app.get(ChannelAdapterRegistry).for('email');
    expect(adapter).toBe(rig.p.h.app.get(EmailChannelAdapter));
    expect(adapter.capabilities({} as ChannelRuntime)).toMatchObject({
      windowHours: null,
      templates: false,
      media: [],
      reactions: false,
      receipts: ['sent'],
    });
  });
});

describe('TW-MAIL-028: a grant Google refuses', () => {
  it('invalid_grant marks the mailbox needs_reauth once, makes its channel read-only, stops sync and send, and a reconnect heals it', async () => {
    rig.fake.revokeGrant(ADDR);
    const res = await sync();
    expect(res).toEqual({ status: 'skipped', reason: 'needs_reauth' });
    const row = await mailboxRow();
    expect(row.status).toBe('needs_reauth');
    expect(String(row.last_error)).toMatch(/Reconnect it/);
    expect(row.access_token_enc).toBeNull();
    const ch = await rig.p.h.owner.query(`SELECT status FROM channels WHERE id = $1`, [channelId]);
    expect(ch.rows[0].status).toBe('disconnected');
    const events = await rig.p.h.owner.query(
      `SELECT event_type FROM event_outbox WHERE org_id = $1 AND event_type = 'mail.mailbox.needs_reauth'`,
      [t.orgId],
    );
    expect(events.rows).toHaveLength(1);
    const hub = await as().get('/v2/email/mailboxes');
    expect(hub.body.data[0]).toMatchObject({ status: 'needs_reauth' });

    // Later runs stop at once, without calling Google again, and the event is not repeated.
    const calls = rig.fake.requests.length;
    expect(await sync()).toEqual({ status: 'skipped', reason: 'needs_reauth' });
    expect(rig.fake.requests.length).toBe(calls);
    expect((await as().post(`/v2/email/mailboxes/${mailboxUuid}/sync`).send({})).status).toBe(409);

    // A reply is refused and nothing is sent.
    const [conv] = await conversations('th-order');
    const sentBefore = rig.fake.sentTo(ADDR).length;
    const reply = await as()
      .post(`/v2/inbox/conversations/${conv!.uuid as string}/messages`)
      .send({ kind: 'text', body: 'Still there?', clientMessageId: randomUUID() });
    if (reply.status === 202) {
      await until('failed', async () => {
        const r = await rig.p.h.owner.query(`SELECT status FROM messages WHERE uuid = $1`, [
          reply.body.id,
        ]);
        return r.rows[0]?.status === 'failed' ? true : undefined;
      });
    } else {
      expect(reply.status).toBeGreaterThanOrEqual(400);
    }
    expect(rig.fake.sentTo(ADDR)).toHaveLength(sentBefore);

    // Reconnect: same row, healthy again, channel back, and what arrived meanwhile is synced.
    const location = await connectMailbox(rig, t, rig.fake.account(ADDR), {
      mailboxId: mailboxUuid,
    });
    expect(outcomeOf(location)).toBe('connected');
    expect(await mailboxRow()).toMatchObject({ status: 'connected', last_error: null });
    expect(
      (await rig.p.h.owner.query(`SELECT status FROM channels WHERE id = $1`, [channelId])).rows[0]
        .status,
    ).toBe('connected');
    // (The callback also queued a sync in the worker, which may take this mail before ours does: either way it is stored once.)
    rig.fake.deliver(ADDR, { threadId: 'th-back', subject: 'Back again', from: SENDER });
    expect(await sync()).toMatchObject({ status: 'synced' });
    expect(await conversations('th-back')).toHaveLength(1);
    expect(await messagesOf((await conversations('th-back'))[0]!.id)).toHaveLength(1);
  });
});

describe('TW-MAIL-030: losing the add-on closes sync and send, and keeps the data', () => {
  it('sync, the sweep and a reply are refused; what was stored stays readable, attachments included', async () => {
    const [files] = await conversations('th-files');
    const [fileMsg] = await messagesOf(files!.id);
    const pdf = (fileMsg!.meta.email.attachments as Array<{ id: string; name: string }>).find(
      (a) => a.name === 'invoice.pdf',
    )!;
    const convsBefore = (await conversations()).length;
    const sentBefore = rig.fake.sentTo(ADDR).length;
    await setMailPlan(rig.p, t.orgId, { feature: false });
    try {
      rig.fake.deliver(ADDR, { threadId: 'th-lapsed', subject: 'After the lapse', from: SENDER });
      const calls = rig.fake.requests.length;
      expect(await sync()).toEqual({ status: 'skipped', reason: 'feature_off' });
      expect(rig.fake.requests.length).toBe(calls);

      const enqueue = vi
        .spyOn(rig.p.h.app.get(MailSyncPublisher), 'enqueue')
        .mockResolvedValue(true);
      try {
        const other = await mailWorkspace(rig.p, 'msw');
        rig.fake.account('other@acme.test');
        expect(
          outcomeOf(await connectMailbox(rig, other, rig.fake.account('other@acme.test'))),
        ).toBe('connected');
        enqueue.mockClear();
        await rig.p.h.app.get(MailSyncSweep).run();
        const queued = enqueue.mock.calls.map((c) => c[0]);
        expect(queued).toContain(other.orgId);
        expect(queued).not.toContain(t.orgId);
      } finally {
        enqueue.mockRestore();
      }

      const adapter = rig.p.h.app.get(EmailChannelAdapter);
      const runtime = {
        orgId: t.orgId,
        uuid: channelUuid,
        kind: 'email',
        externalId: mailboxUuid,
      } as unknown as ChannelRuntime;
      const refused = (await adapter
        .send(runtime, {
          kind: 'text',
          to: 't:x',
          clientReference: 'lapse-1',
          attempt: 1,
          body: 'x',
          email: {
            to: ['ana@example.com'],
            cc: [],
            bcc: [],
            subject: 's',
            inReplyTo: null,
            references: [],
            threadId: 'x',
          },
        })
        .catch((e: unknown) => e)) as ChannelError;
      expect(refused).toMatchObject({ code: 'MAIL_MAILBOX_UNAVAILABLE', retryable: false });
      expect(rig.fake.sentTo(ADDR)).toHaveLength(sentBefore);

      expect((await conversations()).length).toBe(convsBefore);
      const download = await as().get(
        `/v2/email/attachments/${files!.uuid}/${fileMsg!.uuid}/${pdf.id}`,
      );
      expect(download.status).toBe(200);
      expect((await as().get('/v2/email/mailboxes')).status).toBe(422);
    } finally {
      await setMailPlan(rig.p, t.orgId, { feature: true });
    }
    // The add-on comes back: the mail that arrived meanwhile is picked up.
    expect(await sync()).toMatchObject({ status: 'synced', stored: 1 });
    expect(await conversations('th-lapsed')).toHaveLength(1);
  });

  it('the sweep queues only connected mailboxes of workspaces that own the add-on, once each', async () => {
    const enqueue = vi.spyOn(rig.p.h.app.get(MailSyncPublisher), 'enqueue').mockResolvedValue(true);
    try {
      await rig.p.h.app.get(MailSyncSweep).run();
      const mine = enqueue.mock.calls.filter((c) => c[0] === t.orgId);
      expect(mine).toEqual([[t.orgId, mailboxUuid]]);
    } finally {
      enqueue.mockRestore();
    }
  });
});
