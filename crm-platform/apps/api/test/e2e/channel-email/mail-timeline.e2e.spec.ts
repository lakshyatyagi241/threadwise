import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { MailSyncService } from '../../../src/modules/channel-email/mail-sync.service';
import { MailTimeline } from '../../../src/modules/channel-email/mail-timeline.service';
import { until } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import { connectMailbox, mailWorkspace, outcomeOf, startMailRig, type MailRig } from './support';

/**
 * E-19: mail on the contact's Activity Timeline, end to end. A Gmail stand-in feeds the real sync and ingest; a reply leaves through the real
 * adapter; the timeline is read through the CRM's own route with the caller's record scope. Nothing here talks to a real Gmail account.
 */
let rig: MailRig;
let t: Tenant;
let mailboxUuid: string;
const ADDR = 'support@acme.test';

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
const as = (token = t.admin) => rig.p.api.as(token);
const contactUuid = async (email: string): Promise<string> =>
  (
    await rig.p.h.owner.query(
      `SELECT uuid FROM contacts WHERE org_id = $1 AND normalized_email = $2`,
      [t.orgId, email],
    )
  ).rows[0]?.uuid as string;
const timeline = async (email: string, token = t.admin) => {
  const res = await as(token).get(`/v2/contacts/${await contactUuid(email)}/activities`);
  return res;
};
/** A mail entry on the Activity Timeline as these specs read it: its type, and when it happened. */
type MailEntry = Record<string, unknown> & { activityType: string; occurredAt: string };
const mailEntries = async (email: string) => {
  const res = await timeline(email);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.data as MailEntry[]).filter((a) => String(a.activityType).startsWith('email_'));
};
const ledgerCount = async () =>
  Number(
    (
      await rig.p.h.owner.query(
        `SELECT count(*)::int AS n FROM mail_timeline_entries WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows[0].n,
  );

beforeAll(async () => {
  rig = await startMailRig();
  t = await mailWorkspace(rig.p, 'mtl');
  rig.fake.account(ADDR, 'Acme Support');
  const location = await connectMailbox(rig, t, rig.fake.account(ADDR, 'Acme Support'));
  expect(outcomeOf(location)).toBe('connected');
  mailboxUuid = (
    await rig.p.h.owner.query(`SELECT uuid FROM mail_mailboxes WHERE org_id = $1`, [t.orgId])
  ).rows[0].uuid as string;
  await until('first sync by the worker', async () =>
    (
      await rig.p.h.owner.query(
        `SELECT last_synced_at FROM mail_mailboxes WHERE org_id = $1 AND uuid = $2`,
        [t.orgId, mailboxUuid],
      )
    ).rows[0]?.last_synced_at
      ? true
      : undefined,
  );
}, 300_000);

afterAll(async () => {
  await rig?.restore();
});

describe('E-19: a received mail is a line on the contact timeline', () => {
  it('writes one entry per mail with the sender, the subject and a preview, dated when the mail was sent', async () => {
    rig.fake.deliver(ADDR, {
      threadId: 'th-1',
      subject: 'Order question',
      from: 'Ana Customer <ana@example.com>',
      text: 'Where is my order?\n> quoted older mail',
      at: Date.now() - 60_000,
    });
    expect(await sync()).toMatchObject({ status: 'synced', stored: 1 });
    const entries = await mailEntries('ana@example.com');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      activityType: 'email_received',
      title: 'Email received from Ana Customer: Order question',
      body: 'Where is my order?',
      source: 'system',
    });
    expect(Date.now() - new Date(entries[0]!.occurredAt).getTime()).toBeGreaterThan(30_000);
    expect(await ledgerCount()).toBe(1);
  });

  it('is idempotent: the same mail seen again, or recorded again, adds nothing', async () => {
    expect(await sync()).toMatchObject({ stored: 0 });
    expect(await mailEntries('ana@example.com')).toHaveLength(1);
    const timelineSvc = rig.p.h.app.get(MailTimeline);
    const mailbox = { uuid: mailboxUuid, scope: 'shared' as const };
    const [conv] = (
      await rig.p.h.owner.query(
        `SELECT uuid FROM conversations WHERE org_id = $1 AND peer_key = 't:th-1'`,
        [t.orgId],
      )
    ).rows as Array<{ uuid: string }>;
    const mail = {
      providerMessageId: 'a-message-the-sync-already-recorded',
      subject: 'Direct call',
      from: { name: null, address: 'ana@example.com' },
      sentAt: new Date(),
      automated: false,
    };
    const first = await timelineSvc.recordInbound(
      t.orgId,
      mailbox,
      { conversationUuid: conv!.uuid },
      mail,
      'hi',
    );
    const second = await timelineSvc.recordInbound(
      t.orgId,
      mailbox,
      { conversationUuid: conv!.uuid },
      mail,
      'hi',
    );
    expect([first, second]).toEqual(['written', 'duplicate']);
    expect(await mailEntries('ana@example.com')).toHaveLength(2);
  });

  it('leaves out automated mail (an auto-reply) and a thread with no contact', async () => {
    const before = await ledgerCount();
    rig.fake.deliver(ADDR, {
      threadId: 'th-auto',
      subject: 'Out of office',
      from: 'Ana Customer <ana@example.com>',
      headers: [['Auto-Submitted', 'auto-replied']],
    });
    await sync();
    expect(await ledgerCount()).toBe(before);
    const timelineSvc = rig.p.h.app.get(MailTimeline);
    expect(
      await timelineSvc.recordInbound(
        t.orgId,
        { uuid: mailboxUuid, scope: 'shared' },
        { conversationUuid: randomUUID() },
        {
          providerMessageId: 'x',
          subject: 's',
          from: { name: null, address: 'nobody@example.com' },
          sentAt: new Date(),
          automated: false,
        },
        'hello',
      ),
    ).toBe('no_contact');
  });
});

describe('E-19: a sent reply is a line on the contact timeline', () => {
  it('writes one entry for the reply, by the person who sent it, and a repeated request adds nothing', async () => {
    const [conv] = (
      await rig.p.h.owner.query(
        `SELECT uuid FROM conversations WHERE org_id = $1 AND peer_key = 't:th-1'`,
        [t.orgId],
      )
    ).rows as Array<{ uuid: string }>;
    const clientMessageId = randomUUID();
    const body = {
      kind: 'text',
      body: 'Your order ships today.',
      clientMessageId,
      email: { cc: [], bcc: [], subject: 'Your order' },
    };
    const res = await as().post(`/v2/inbox/conversations/${conv!.uuid}/messages`).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    await until('reply sent', async () => {
      const r = await rig.p.h.owner.query(`SELECT status FROM messages WHERE uuid = $1`, [
        res.body.id,
      ]);
      return r.rows[0]?.status === 'sent' ? true : undefined;
    });
    await until('timeline entry', async () =>
      (await mailEntries('ana@example.com')).some((e) => e.activityType === 'email_sent')
        ? true
        : undefined,
    );
    const sent = (await mailEntries('ana@example.com')).filter(
      (e) => e.activityType === 'email_sent',
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      title: 'Email sent to ana@example.com: Your order',
      body: 'Your order ships today.',
      source: 'user',
    });
    expect(sent[0]!.actorId).toBeTruthy();

    await as().post(`/v2/inbox/conversations/${conv!.uuid}/messages`).send(body);
    expect(
      (await mailEntries('ana@example.com')).filter((e) => e.activityType === 'email_sent'),
    ).toHaveLength(1);
  });
});

describe('E-19: who may read it, and which mailboxes write', () => {
  it('reading follows the contact: a person without access to this contact gets no timeline', async () => {
    const own = await rig.p.api.member(t, 'ownreader', [['record.contacts.read', 'own']]);
    const res = await timeline('ana@example.com', own.token);
    expect([403, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain('Order question');
  });

  it('another workspace never sees the ledger or the entries', async () => {
    const other = await mailWorkspace(rig.p, 'mtl-other');
    const res = await rig.p.api
      .as(other.admin)
      .get(`/v2/contacts/${await contactUuid('ana@example.com')}/activities`);
    expect(res.status).toBe(404);
    const rows = await rig.p.h.owner.query(
      `SELECT count(*)::int AS n FROM mail_timeline_entries WHERE org_id = $1`,
      [other.orgId],
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it('a personal mailbox writes nothing to the shared timeline', async () => {
    const before = await ledgerCount();
    const owner = (
      await rig.p.h.owner.query(`SELECT id FROM users WHERE org_id = $1 ORDER BY id LIMIT 1`, [
        t.orgId,
      ])
    ).rows[0].id;
    await rig.p.h.owner.query(
      `UPDATE mail_mailboxes SET scope = 'personal', owner_user_id = $3 WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, mailboxUuid, owner],
    );
    rig.fake.deliver(ADDR, {
      threadId: 'th-private',
      subject: 'Private matter',
      from: 'Ana Customer <ana@example.com>',
      text: 'confidential words',
    });
    await sync();
    expect(await ledgerCount()).toBe(before);
    const res = await timeline('ana@example.com');
    expect(JSON.stringify(res.body)).not.toMatch(/Private matter|confidential/);
  });
});
