import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { InboundMessageHooks } from '../../../src/modules/chat-conversations';
import { EmailChannelAdapter } from '../../../src/modules/channel-email/email-channel.adapter';
import { MailSyncService } from '../../../src/modules/channel-email/mail-sync.service';
import {
  ChannelError,
  type ChannelRuntime,
} from '../../../src/infra/providers/chat-conversations/channel.port';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import type { GmailPart } from '../../../src/infra/providers/channel-email';
import { until } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import type { Delivery } from './fake-gmail';
import { connectMailbox, mailWorkspace, startMailRig, type MailRig } from './support';

/**
 * Bounces, loop protection and send limits (TW-MAIL-032) end to end: a delivery-status notification arrives through the Gmail stand-in,
 * the real sync, the real ingest and the real inbox pipeline, and is applied to the reply it is about. Google is a local stand-in written
 * from its documentation: no real Gmail account is involved.
 */
let rig: MailRig;
let t: Tenant;
const ADDR = 'support@acme.test';
const ADDR2 = 'sales@acme.test';
const owners = new Map<string, { uuid: string; channelUuid: string }>();

const asTenant = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    {
      requestId: `spec-${randomUUID()}`,
      orgId: t.orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    fn,
  );
const sync = (addr = ADDR) =>
  asTenant(() => rig.p.h.app.get(MailSyncService).sync(t.orgId, owners.get(addr)!.uuid));
const q = async (text: string, params: unknown[] = []) =>
  (await rig.p.h.owner.query(text, params)).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const conversations = (thread?: string) =>
  q(
    `SELECT * FROM conversations WHERE org_id = $1 ${thread ? 'AND peer_key = $2' : ''} ORDER BY id`,
    thread ? [t.orgId, `t:${thread}`] : [t.orgId],
  );
const messagesOf = (conversationId: unknown) =>
  q(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq`, [conversationId]);
const runtime = (addr = ADDR) =>
  ({
    orgId: t.orgId,
    uuid: owners.get(addr)!.channelUuid,
    kind: 'email',
    externalId: owners.get(addr)!.uuid,
  }) as unknown as ChannelRuntime;
const envelope = (ref: string, to: string, extra: Record<string, unknown> = {}) => ({
  kind: 'text' as const,
  to: 't:x',
  clientReference: ref,
  attempt: 1,
  body: 'Hello',
  email: {
    to: [to],
    cc: [],
    bcc: [],
    subject: 'Re: x',
    inReplyTo: null,
    references: [],
    threadId: 'x',
    ...extra,
  },
});
const rawOf = (m: { raw: string }) => m.raw.split(/\r?\n\r?\n/)[0]!.replace(/\r?\n[ \t]+/g, ' ');

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const part = (id: string, mimeType: string, text: string): GmailPart => ({
  partId: id,
  mimeType,
  filename: '',
  headers: [{ name: 'Content-Type', value: mimeType }],
  body: { size: text.length, data: b64(text) },
});

/** A Gmail style DSN about `messageId`, sent to the mailbox by the mail system. */
const dsn = (o: {
  recipient: string;
  messageId: string;
  status?: string;
  action?: string;
  subject?: string;
  diagnostic?: string;
}): Delivery => ({
  threadId: `dsn-${randomUUID()}`,
  from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
  subject: o.subject ?? 'Delivery Status Notification (Failure)',
  text: `Your message wasn't delivered to ${o.recipient}.`,
  contentType: 'multipart/report; report-type=delivery-status; boundary="b"',
  headers: [['Auto-Submitted', 'auto-replied']],
  extraParts: [
    part(
      '9',
      'message/delivery-status',
      `Reporting-MTA: dns; googlemail.com\n\nFinal-Recipient: rfc822; ${o.recipient}\nAction: ${o.action ?? 'failed'}\nStatus: ${o.status ?? '5.1.1'}\nDiagnostic-Code: smtp; ${o.diagnostic ?? '550 5.1.1 The email account does not exist'}`,
    ),
    part(
      '10',
      'text/rfc822-headers',
      `Message-ID: <${o.messageId}>\nSubject: Re: Order\nTo: ${o.recipient}`,
    ),
  ],
});

const connect = async (addr: string) => {
  rig.fake.account(addr, addr.split('@')[0]);
  await connectMailbox(rig, t, rig.fake.account(addr, addr.split('@')[0]));
  const row = (
    await q(
      `SELECT uuid, channel_uuid, last_synced_at FROM mail_mailboxes WHERE org_id = $1 AND address = $2`,
      [t.orgId, addr],
    )
  )[0]!;
  owners.set(addr, { uuid: row.uuid, channelUuid: row.channel_uuid });
  await until(`first sync of ${addr}`, async () =>
    (await q(`SELECT last_synced_at FROM mail_mailboxes WHERE uuid = $1`, [row.uuid]))[0]
      ?.last_synced_at
      ? true
      : undefined,
  );
};

/** A customer mail arrives and is synced; returns the conversation. */
async function customerThread(thread: string, from: string) {
  rig.fake.deliver(ADDR, {
    threadId: thread,
    from,
    subject: 'Order',
    messageId: `${thread}@c.example`,
  });
  await sync();
  return (await conversations(thread))[0]!;
}

/** Sends a reply through the inbox API and waits for the provider to have it. Returns the Message-ID it went out with. */
async function reply(conv: Record<string, unknown>, text = 'We are on it.') {
  const before = rig.fake.sentTo(ADDR).length;
  const clientMessageId = randomUUID();
  const res = await rig.p.api
    .as(t.admin)
    .post(`/v2/inbox/conversations/${conv.uuid as string}/messages`)
    .send({ kind: 'text', body: text, clientMessageId });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  await until('reply sent', async () => (rig.fake.sentTo(ADDR).length > before ? true : undefined));
  return { uuid: res.body.id as string, messageId: `tw.${clientMessageId}@acme.test` };
}

const listener = vi.fn(() => Promise.resolve());

beforeAll(async () => {
  rig = await startMailRig();
  t = await mailWorkspace(rig.p, 'bnc', 3);
  await connect(ADDR);
  await connect(ADDR2);
  rig.p.h.app.get(InboundMessageHooks).register({
    name: 'bounce-spec',
    runsOnEmail: true,
    onStored: listener,
  });
}, 300_000);

afterAll(async () => {
  delete process.env.MAIL_INBOUND_FLOOD_MAX;
  await rig?.restore();
});

describe('TW-MAIL-032: a bounce is applied to the reply it is about', () => {
  let conv: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  let sent: { uuid: string; messageId: string };

  it('a hard bounce marks the sent message bounced, adds a system line and never opens a conversation or fires a listener', async () => {
    conv = await customerThread('th-hard', 'Nobody <nobody@example.org>');
    expect(listener).toHaveBeenCalledTimes(1);
    sent = await reply(conv);
    const conversationsBefore = (await conversations()).length;
    const callsBefore = listener.mock.calls.length;

    rig.fake.deliver(ADDR, dsn({ recipient: 'nobody@example.org', messageId: sent.messageId }));
    const res = await sync();
    expect(res).toMatchObject({ status: 'synced', stored: 0, failed: 0 });

    const msgs = await messagesOf(conv.id);
    const original = msgs.find((m) => m.uuid === sent.uuid)!;
    expect(original.status).toBe('sent');
    expect(original.meta.email).toMatchObject({
      delivery: 'bounced',
      bounce: {
        kind: 'hard',
        failedRecipient: 'nobody@example.org',
        reason: expect.stringContaining('does not exist'),
      },
    });
    const line = msgs.find((m) => m.kind === 'system')!;
    expect(line).toMatchObject({ direction: 'out', sender_kind: 'system' });
    expect(line.body).toBe(
      'Not delivered to nobody@example.org: 550 5.1.1 The email account does not exist',
    );
    // Nothing else: no conversation for the DSN, no message for it, no listener.
    expect(await conversations()).toHaveLength(conversationsBefore);
    expect(listener.mock.calls.length).toBe(callsBefore);
    expect(
      await q(
        `SELECT 1 FROM messages WHERE org_id = $1 AND meta -> 'email' ->> 'subject' ILIKE 'Delivery Status%'`,
        [t.orgId],
      ),
    ).toHaveLength(0);
    // The sender is told through the notification pipeline (the outbox event the consumer reads).
    const events = await q(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'email.message_bounced'`,
      [t.orgId],
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      messageId: sent.uuid,
      failedRecipient: 'nobody@example.org',
      kind: 'hard',
      senderUserId: t.adminUserId,
    });
    // The contact's email identity is no longer verified.
    const ident = await q(
      `SELECT verified FROM contact_identities WHERE org_id = $1 AND kind = 'email' AND value = 'nobody@example.org'`,
      [t.orgId],
    );
    expect(ident.every((r) => r.verified === false)).toBe(true);
  });

  it('the thread API shows the delivery state and the system line', async () => {
    const api = await rig.p.api
      .as(t.admin)
      .get(`/v2/inbox/conversations/${conv.uuid as string}/messages`);
    expect(api.status).toBe(200);
    const out = (api.body.data as Array<Record<string, any>>).find((m) => m.id === sent.uuid)!; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(out.email).toMatchObject({ delivery: 'bounced', bounce: { kind: 'hard' } });
  });

  it('a redelivered bounce changes nothing (no second line, no second event)', async () => {
    await q(
      `UPDATE mail_mailboxes SET sync_cursor = jsonb_build_object('historyId', '1000') WHERE org_id = $1 AND address = $2`,
      [t.orgId, ADDR],
    );
    await sync();
    expect((await messagesOf(conv.id)).filter((m) => m.kind === 'system')).toHaveLength(1);
    expect(
      await q(
        `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'email.message_bounced'`,
        [t.orgId],
      ),
    ).toHaveLength(1);
  });

  it('after a hard bounce further mail to that address is refused with a clear code', async () => {
    const adapter = rig.p.h.app.get(EmailChannelAdapter);
    const err = (await adapter
      .send(runtime(), envelope('again-1', 'nobody@example.org'))
      .catch((e: unknown) => e)) as ChannelError;
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toMatchObject({ code: 'MAIL_RECIPIENT_BOUNCED', retryable: false });
    // Another address and another mailbox are not affected.
    await expect(
      adapter.send(runtime(), envelope('ok-1', 'someone@example.org')),
    ).resolves.toBeTruthy();
  });

  it('a soft bounce is recorded as soft, does not block the address and is told with its own wording', async () => {
    const c = await customerThread('th-soft', 'Bob <bob@example.net>');
    const s = await reply(c);
    rig.fake.deliver(
      ADDR,
      dsn({
        recipient: 'bob@example.net',
        messageId: s.messageId,
        status: '4.2.2',
        action: 'delayed',
        diagnostic: '452 4.2.2 Mailbox full',
        subject: 'Delivery Status Notification (Delay)',
      }),
    );
    await sync();
    const msgs = await messagesOf(c.id);
    expect(msgs.find((m) => m.uuid === s.uuid)!.meta.email.bounce).toMatchObject({
      kind: 'soft',
      failedRecipient: 'bob@example.net',
    });
    expect(msgs.find((m) => m.kind === 'system')!.body).toBe(
      'Delivery to bob@example.net is delayed: 452 4.2.2 Mailbox full',
    );
    const adapter = rig.p.h.app.get(EmailChannelAdapter);
    await expect(
      adapter.send(runtime(), envelope('soft-ok', 'bob@example.net')),
    ).resolves.toBeTruthy();
  });

  it('an Exchange style NDR with no machine part, quoting the original Message-ID, is linked the same way', async () => {
    const c = await customerThread('th-ndr', 'Dave <dave@contoso.com>');
    const s = await reply(c);
    rig.fake.deliver(ADDR, {
      threadId: 'ndr-1',
      from: 'Microsoft Outlook <postmaster@contoso.com>',
      subject: 'Undeliverable: Re: Order',
      text: `Your message to dave@contoso.com couldn't be delivered.\nRemote Server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound'\nMessage-ID: <${s.messageId}>`,
    });
    await sync();
    const msgs = await messagesOf(c.id);
    expect(msgs.find((m) => m.uuid === s.uuid)!.meta.email.bounce).toMatchObject({
      kind: 'hard',
      failedRecipient: 'dave@contoso.com',
    });
    expect(await conversations('ndr-1')).toHaveLength(0);
  });

  it('a bounce that names no mail of this mailbox is dropped: no conversation, no message', async () => {
    const before = (await conversations()).length;
    rig.fake.deliver(
      ADDR,
      dsn({ recipient: 'ghost@example.org', messageId: 'unknown-id@elsewhere' }),
    );
    await sync();
    expect(await conversations()).toHaveLength(before);
  });

  it('an out-of-office from a person is NOT a bounce: it is stored as an automated mail', async () => {
    rig.fake.deliver(ADDR, {
      threadId: 'th-ooo',
      from: 'Ana <ana@example.com>',
      subject: 'Out of office',
      text: 'I am away.',
      headers: [['Auto-Submitted', 'auto-replied']],
    });
    await sync();
    const [c] = await conversations('th-ooo');
    expect((await messagesOf(c!.id))[0]!.meta.email.automated).toBe(true);
  });
});

describe('TW-MAIL-032: loop protection', () => {
  it('mail an automation sent says Auto-Submitted; mail a person sent does not', async () => {
    const adapter = rig.p.h.app.get(EmailChannelAdapter);
    const before = rig.fake.sentTo(ADDR).length;
    await adapter.send(runtime(), envelope('bot-1', 'a1@example.org'));
    await adapter.send(
      runtime(),
      envelope('person-1', 'a2@example.org', { sentBy: t.adminUserId }),
    );
    const [bot, person] = rig.fake.sentTo(ADDR).slice(before);
    expect(rawOf(bot!)).toMatch(/^Auto-Submitted: auto-generated$/im);
    expect(rawOf(person!)).not.toMatch(/Auto-Submitted/i);
  });
});

describe('TW-MAIL-032: send limits', () => {
  it('the hourly cap of a mailbox is its own setting; over it the send is MAIL_RATE_LIMITED with a wait, the other mailbox is unaffected, and the window resets', async () => {
    const mb = (await rig.p.api.as(t.admin).get('/v2/email/mailboxes')).body.data.find(
      (m: { address: string }) => m.address === ADDR2,
    );
    const patch = await rig.p.api
      .as(t.admin)
      .patch(`/v2/email/mailboxes/${mb.id as string}`)
      .send({
        displayName: mb.displayName,
        sendLimitPerHour: 2,
        rowVersion: mb.rowVersion,
      });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.sendLimitPerHour).toBe(2);

    const adapter = rig.p.h.app.get(EmailChannelAdapter);
    await adapter.send(runtime(ADDR2), envelope('rl-1', 'r1@example.org'));
    await adapter.send(runtime(ADDR2), envelope('rl-2', 'r2@example.org'));
    const over = (await adapter
      .send(runtime(ADDR2), envelope('rl-3', 'r3@example.org'))
      .catch((e: unknown) => e)) as ChannelError;
    expect(over).toMatchObject({ code: 'MAIL_RATE_LIMITED', retryable: false });
    expect(over.retryAfterMs).toBeGreaterThan(0);
    expect(over.message).toContain('limit of 2 emails per hour');
    expect(rig.fake.sentTo(ADDR2)).toHaveLength(2);

    // The other mailbox keeps sending.
    await expect(
      adapter.send(runtime(ADDR), envelope('rl-other', 'r4@example.org')),
    ).resolves.toBeTruthy();

    // An hour later (the recorded sends age out of the window) the mailbox sends again.
    const redis = rig.p.h.app.get<Redis>(REDIS_CLIENT);
    const key = `mail:rl:${t.orgId}:${owners.get(ADDR2)!.uuid}`;
    const members = await redis.zrange(key, 0, '-1');
    for (const m of members) await redis.zadd(key, Date.now() - 3_700_000, m);
    await expect(
      adapter.send(runtime(ADDR2), envelope('rl-4', 'r5@example.org')),
    ).resolves.toBeTruthy();
  });

  it('a burst to one recipient is limited and retryable; the limit is per recipient', async () => {
    const adapter = rig.p.h.app.get(EmailChannelAdapter);
    for (let i = 0; i < 5; i++)
      await adapter.send(runtime(), envelope(`burst-${i}`, 'burst@example.org'));
    const over = (await adapter
      .send(runtime(), envelope('burst-over', 'burst@example.org'))
      .catch((e: unknown) => e)) as ChannelError;
    expect(over).toMatchObject({ code: 'MAIL_RATE_LIMITED', retryable: true });
    expect(over.retryAfterMs).toBeGreaterThan(0);
    await expect(
      adapter.send(runtime(), envelope('burst-other', 'calm@example.org')),
    ).resolves.toBeTruthy();
  });

  it('a reply refused by the cap ends as a failed message carrying MAIL_RATE_LIMITED (what the composer shows)', async () => {
    await q(
      `UPDATE mail_mailboxes SET send_limit_per_hour = 1 WHERE org_id = $1 AND address = $2`,
      [t.orgId, ADDR2],
    );
    const redis = rig.p.h.app.get<Redis>(REDIS_CLIENT);
    await redis.del(`mail:rl:${t.orgId}:${owners.get(ADDR2)!.uuid}`);
    const adapter = rig.p.h.app.get(EmailChannelAdapter);
    await adapter.send(runtime(ADDR2), envelope('cap-1', 'cap1@example.org'));
    rig.fake.deliver(ADDR2, { threadId: 'th-cap', from: 'Cap <cap@example.org>', subject: 'Hi' });
    await sync(ADDR2);
    const c = (await conversations('th-cap'))[0]!;
    const res = await rig.p.api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${c.uuid as string}/messages`)
      .send({ kind: 'text', body: 'Hello', clientMessageId: randomUUID() });
    expect(res.status).toBe(202);
    const failed = await until('failed message', async () => {
      const r = await q(
        `SELECT status, failure_code, failure_reason FROM messages WHERE uuid = $1`,
        [res.body.id],
      );
      return r[0]?.status === 'failed' ? r[0] : undefined;
    });
    expect(failed.failure_code).toBe('MAIL_RATE_LIMITED');
    expect(failed.failure_reason).toContain('Try again in');
  });

  it('the cap is validated and needs the manage permission', async () => {
    const mb = (await rig.p.api.as(t.admin).get('/v2/email/mailboxes')).body.data[0];
    const bad = await rig.p.api
      .as(t.admin)
      .patch(`/v2/email/mailboxes/${mb.id as string}`)
      .send({ displayName: 'x', sendLimitPerHour: 0, rowVersion: mb.rowVersion });
    expect(bad.status).toBe(422);
    const viewer = await rig.p.api.member(t, 'viewer-rl', [['mail.mailboxes.read']]);
    const denied = await rig.p.api
      .as(viewer.token)
      .patch(`/v2/email/mailboxes/${mb.id as string}`)
      .send({ displayName: 'x', sendLimitPerHour: 5, rowVersion: mb.rowVersion });
    expect(denied.status).toBe(403);
  });
});

describe('TW-MAIL-032: inbound flood', () => {
  it('a sender over the limit is still stored but flagged automated and quiet: no unread, no listener', async () => {
    process.env.MAIL_INBOUND_FLOOD_MAX = '3';
    listener.mockClear();
    for (let i = 0; i < 5; i++) {
      rig.fake.deliver(ADDR, {
        threadId: 'th-flood',
        from: 'Spam <flood@example.org>',
        subject: 'Buy',
        messageId: `flood-${i}@x.example`,
        text: `n${i}`,
      });
    }
    await sync();
    const [c] = await conversations('th-flood');
    const msgs = await messagesOf(c!.id);
    expect(msgs).toHaveLength(5);
    expect(msgs.map((m) => m.meta.email.automated)).toEqual([false, false, false, true, true]);
    expect(c!.unread_count).toBe(3);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
