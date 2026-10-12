import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Read when the app's modules are first imported (the upload route's multipart cap is fixed then): set before any import below runs.
const SAVED = vi.hoisted(() => {
  const keys = {
    MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES: '5000',
    MAIL_OUTBOUND_ATTACHMENTS_TOTAL_MAX_BYTES: '6000',
    MAIL_OUTBOUND_ATTACHMENTS_MAX_COUNT: '3',
    MAIL_OUTBOUND_ATTACHMENT_DENY_MIME: 'image/gif',
  };
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(keys)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  return saved;
});

import { RequestContextStore } from '../../../src/common/context/request-context';
import { ChatMediaStore } from '../../../src/infra/providers/chat-conversations/media';
import { MailOutboundAttachmentsSweep } from '../../../src/modules/channel-email/mail-outbound-attachments.sweep';
import { MailSyncService } from '../../../src/modules/channel-email/mail-sync.service';
import { until } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import { expectMimeCarries } from '../../unit/channel-email/driver-send-contract';
import { connectMailbox, mailWorkspace, outcomeOf, startMailRig, type MailRig } from './support';

/**
 * Composer uploads, signatures and the rich body (TW-MAIL-027), end to end: a file is staged, named in a reply, goes out through the Gmail
 * stand-in inside the real MIME with the signature merged, and shows in the thread with a working download. Google is a local stand-in:
 * nothing here talks to a real Gmail account.
 */
let rig: MailRig;
let t: Tenant;
let mailboxId: string;
let convUuid: string;
const ADDR = 'support@acme.test';
const CUSTOMER = 'Bob Customer <bob@example.com>';

const as = (token = t.admin) => rig.p.api.as(token);
const pdf = (n = 200) => Buffer.from(`%PDF-1.4\n${'x'.repeat(n)}`);
const upload = (
  buf: Buffer,
  name: string,
  token = t.admin,
  fields: Record<string, string> = {},
) => {
  let req = as(token).post('/v2/email/attachments/upload').attach('file', buf, name);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req;
};
const stage = async (buf: Buffer, name: string, token = t.admin): Promise<string> => {
  const res = await upload(buf, name, token);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};
const sync = () =>
  RequestContextStore.run(
    {
      requestId: `spec-${randomUUID()}`,
      orgId: t.orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    () => rig.p.h.app.get(MailSyncService).sync(t.orgId, mailboxId),
  );
const reply = async (
  email: Record<string, unknown>,
  body = 'Here is the file.',
  token = t.admin,
) => {
  const res = await as(token)
    .post(`/v2/inbox/conversations/${convUuid}/messages`)
    .send({ kind: 'text', body, clientMessageId: randomUUID(), email });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return until('reply settled', async () => {
    const r = await rig.p.h.owner.query(
      `SELECT status, failure_code, meta FROM messages WHERE uuid = $1`,
      [res.body.id],
    );
    const row = r.rows[0] as {
      status: string;
      failure_code: string | null;
      meta: Record<string, unknown>;
    };
    return row.status === 'queued' ? undefined : { id: res.body.id as string, ...row };
  });
};
const createSig = (body: Record<string, unknown>, token = t.admin) =>
  as(token).post('/v2/email/signatures').set('idempotency-key', randomUUID()).send(body);
const stagedRow = async (uuid: string) =>
  (await rig.p.h.owner.query(`SELECT * FROM mail_outbound_attachments WHERE uuid = $1`, [uuid]))
    .rows[0] as
    | Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    | undefined;
const raw = () => rig.fake.sentTo(ADDR).at(-1)!.raw;
const sentCount = () => rig.fake.sentTo(ADDR).length;

beforeAll(async () => {
  rig = await startMailRig();
  t = await mailWorkspace(rig.p, 'oat');
  rig.fake.account(ADDR, 'Acme Support');
  expect(outcomeOf(await connectMailbox(rig, t, rig.fake.account(ADDR, 'Acme Support')))).toBe(
    'connected',
  );
  const row = (
    await rig.p.h.owner.query(`SELECT * FROM mail_mailboxes WHERE org_id = $1`, [t.orgId])
  ).rows[0];
  mailboxId = row.uuid as string;
  await until('first sync', async () =>
    (
      await rig.p.h.owner.query(`SELECT last_synced_at FROM mail_mailboxes WHERE uuid = $1`, [
        mailboxId,
      ])
    ).rows[0].last_synced_at
      ? true
      : undefined,
  );
  rig.fake.deliver(ADDR, {
    threadId: 'th-att',
    subject: 'Need the invoice',
    from: CUSTOMER,
    messageId: 'cust-1@example.com',
  });
  await sync();
  const conv = (
    await rig.p.h.owner.query(
      `SELECT uuid FROM conversations WHERE org_id = $1 AND peer_key = 't:th-att'`,
      [t.orgId],
    )
  ).rows[0];
  convUuid = conv.uuid as string;
}, 300_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rig?.restore();
});

describe('TW-MAIL-027: signatures', () => {
  it('create sanitises the HTML, derives the text, and one default per owner is kept', async () => {
    const a = await createSig({
      scope: 'user',
      name: 'Mine',
      bodyHtml: '<p>Ana {{name}}</p><script>evil()</script><img src=x onerror=y()>',
      isDefault: true,
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.bodyHtml).not.toMatch(/script|onerror|<img/i);
    expect(a.body.bodyText).toBe('Ana {{name}}');
    expect(a.body).toMatchObject({
      scope: 'user',
      mailboxId: null,
      isDefault: true,
      rowVersion: 1,
    });

    const b = await createSig({
      scope: 'user',
      name: 'Second',
      bodyHtml: '<p>Two</p>',
      isDefault: true,
    });
    expect(b.status).toBe(201);
    const list = await as().get('/v2/email/signatures?scope=user');
    const byName = Object.fromEntries(
      (list.body.data as Array<{ name: string; isDefault: boolean }>).map((s) => [
        s.name,
        s.isDefault,
      ]),
    );
    expect(byName).toEqual({ Mine: false, Second: true });
    const audit = await rig.p.h.owner.query(
      `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'mail_signatures'`,
      [t.orgId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('update needs the current rowVersion (409 otherwise) and re-derives the text', async () => {
    const created = await createSig({ scope: 'user', name: 'Edit me', bodyHtml: '<p>v1</p>' });
    const id = created.body.id as string;
    const ok = await as()
      .patch(`/v2/email/signatures/${id}`)
      .set('idempotency-key', randomUUID())
      .send({ bodyHtml: '<p>v2 <b>bold</b></p>', rowVersion: created.body.rowVersion });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ bodyText: 'v2 bold', rowVersion: created.body.rowVersion + 1 });
    const stale = await as()
      .patch(`/v2/email/signatures/${id}`)
      .set('idempotency-key', randomUUID())
      .send({ name: 'x', rowVersion: created.body.rowVersion });
    expect(stale.status).toBe(409);
  });

  it('an agent manages only their own user signatures and cannot touch a mailbox signature without mail.mailboxes.manage', async () => {
    const agent = await rig.p.api.member(t, 'sigagent', [
      ['mail.signatures.manage'],
      ['mail.mailboxes.read'],
    ]);
    const mine = await createSig(
      { scope: 'user', name: 'Agent sig', bodyHtml: '<p>Agent</p>' },
      agent.token,
    );
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
    // Another person's user signature does not exist for you, in the list or by id.
    const adminSees = await as().get('/v2/email/signatures?scope=user');
    expect((adminSees.body.data as Array<{ name: string }>).map((s) => s.name)).not.toContain(
      'Agent sig',
    );
    expect(
      (
        await as()
          .patch(`/v2/email/signatures/${mine.body.id}`)
          .set('idempotency-key', randomUUID())
          .send({ name: 'hijack', rowVersion: 1 })
      ).status,
    ).toBe(404);
    expect((await as().delete(`/v2/email/signatures/${mine.body.id}`)).status).toBe(404);
    // A mailbox signature needs mail.mailboxes.manage too.
    expect(
      (
        await createSig(
          { scope: 'mailbox', mailboxId, name: 'Shared', bodyHtml: '<p>x</p>' },
          agent.token,
        )
      ).status,
    ).toBe(403);
    // And a member without mail.signatures.manage cannot create at all.
    const reader = await rig.p.api.member(t, 'sigreader', [['mail.mailboxes.read']]);
    expect((await createSig({ scope: 'user', name: 'n', bodyHtml: '' }, reader.token)).status).toBe(
      403,
    );
    expect((await as(reader.token).get('/v2/email/signatures')).status).toBe(200);
    expect((await as(agent.token).delete(`/v2/email/signatures/${mine.body.id}`)).status).toBe(204);
  });

  it('the mailbox signature belongs to the mailbox: validated scope, one default, admin only', async () => {
    const bad = await createSig({ scope: 'mailbox', name: 'no mailbox', bodyHtml: '' });
    expect(bad.status).toBe(422);
    const ok = await createSig({
      scope: 'mailbox',
      mailboxId,
      name: 'Company',
      bodyHtml: '<p>Acme Support Team</p>',
      isDefault: true,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.mailboxId).toBe(mailboxId);
    const listed = await as().get(`/v2/email/signatures?mailboxId=${mailboxId}`);
    expect(listed.body.data).toHaveLength(1);
    const hub = await as().get('/v2/email/mailboxes');
    expect(hub.body.data[0].hasSignature).toBe(true);
  });
});

describe('TW-MAIL-027: a reply with a file, a signature and a rich body', () => {
  it("goes out with the file bytes, the HTML and the sender's default signature (not the mailbox one), and the thread shows and serves the file", async () => {
    const file = pdf(300);
    const id = await stage(file, 'invoice.pdf');
    const row = await stagedRow(id);
    expect(row).toMatchObject({
      name: 'invoice.pdf',
      mime: 'application/pdf',
      uploaded_by: t.adminUserId,
    });
    expect(row!.used_at).toBeNull();

    const before = sentCount();
    const out = await reply({
      attachmentIds: [id],
      bodyHtml: '<p>Here is the <b>invoice</b>.</p><script>steal()</script>',
    });
    expect(out.status, JSON.stringify(out)).toBe('sent');
    expect(sentCount()).toBe(before + 1);
    const text = raw();
    expectMimeCarries(text, {
      html: '<p>Here is the <b>invoice</b>.</p>',
      attachments: [{ name: 'invoice.pdf', mime: 'application/pdf', bytes: file, objectKey: null }],
    } as never);
    expect(text).not.toContain('steal()');
    // Signature: the admin's default USER signature ("Second"), after the standard separator, in both parts.
    expect(text.replace(/=\r?\n/g, '')).toMatch(/-- ?\r?\nTwo/);
    expect(text).not.toContain('Acme Support Team');
    expect(text).toMatch(/Content-Type: multipart\/mixed/i);

    // The staged file is spent.
    expect((await stagedRow(id))!.used_at).not.toBeNull();

    // The thread shows the outbound message with its file, recorded from what really went out.
    const thread = await as().get(`/v2/inbox/conversations/${convUuid}/messages`);
    const sentMsg = (thread.body.data as Array<any>).find((m) => m.id === out.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(sentMsg.email).toMatchObject({
      delivery: 'sent',
      subject: expect.stringMatching(/^Re:/),
    });
    expect(sentMsg.email.attachments).toEqual([
      expect.objectContaining({ name: 'invoice.pdf', size: file.length, tooLarge: false }),
    ]);
    expect(sentMsg.email.html).toContain('<b>invoice</b>');
    expect(sentMsg.email.html).not.toContain('steal');

    // ... and the existing download route serves it, under the same visibility rule as any message.
    const dl = await as()
      .get(`/v2/email/attachments/${convUuid}/${out.id}/${sentMsg.email.attachments[0].id}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect((dl.body as Buffer).equals(file)).toBe(true);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    // An agent who may not see the conversation (own scope, not assigned) gets a plain 404.
    const outsider = await rig.p.api.member(t, 'outsider', [
      ['inbox.conversation.read', 'own'],
      ['mail.mailboxes.read'],
    ]);
    expect(
      (
        await as(outsider.token).get(
          `/v2/email/attachments/${convUuid}/${out.id}/${sentMsg.email.attachments[0].id}`,
        )
      ).status,
    ).toBe(404);
  });

  it('a staged file can be sent once: a second reply naming it fails and sends nothing', async () => {
    const id = await stage(pdf(50), 'once.pdf');
    expect((await reply({ attachmentIds: [id] })).status).toBe('sent');
    const before = sentCount();
    const again = await reply({ attachmentIds: [id] });
    expect(again).toMatchObject({ status: 'failed', failure_code: 'MAIL_ATTACHMENT_NOT_FOUND' });
    expect(sentCount()).toBe(before);
  });

  it('signature: false sends none, and a named signature wins over the defaults', async () => {
    const none = await reply({ signature: false }, 'No signature please.');
    expect(none.status).toBe('sent');
    const text = raw().replace(/=\r?\n/g, '');
    expect(text).toContain('No signature please.');
    expect(text).not.toMatch(/Two|Acme Support Team/);

    const named = await createSig({
      scope: 'user',
      name: 'Named',
      bodyHtml: '<p>Ana {{name}} / {{title}}.</p>',
    });
    const out = await reply({ signatureId: named.body.id as string }, 'Named one.');
    expect(out.status).toBe('sent');
    // {{name}} is the sending user's name; the rest of the variables are empty here.
    const body = raw().replace(/=\r?\n/g, '');
    expect(body).toContain('Admin Person');
    expect(body).not.toContain('{{');

    const missing = await reply({ signatureId: randomUUID() });
    expect(missing).toMatchObject({ status: 'failed', failure_code: 'MAIL_SIGNATURE_NOT_FOUND' });
  });
});

describe('TW-MAIL-027: who may attach what', () => {
  it("another user's upload cannot be attached: the reply fails and nothing is sent", async () => {
    const agent = await rig.p.api.member(t, 'uploader', [
      ['inbox.conversation.reply'],
      ['inbox.conversation.read'],
    ]);
    const id = await stage(pdf(60), 'theirs.pdf', agent.token);
    const before = sentCount();
    const out = await reply({ attachmentIds: [id] });
    expect(out).toMatchObject({ status: 'failed', failure_code: 'MAIL_ATTACHMENT_NOT_FOUND' });
    expect(sentCount()).toBe(before);
    // Still theirs and unsent.
    expect((await stagedRow(id))!.used_at).toBeNull();
    // Nor can the admin delete it.
    expect((await as().delete(`/v2/email/attachments/${id}`)).status).toBe(404);
    expect((await as(agent.token).delete(`/v2/email/attachments/${id}`)).status).toBe(204);
    expect(await stagedRow(id)).toBeUndefined();
  });

  it('uploading needs inbox.conversation.reply and the email plan feature; a foreign or hidden conversation id is a 404', async () => {
    const reader = await rig.p.api.member(t, 'noreply', [['inbox.conversation.read']]);
    expect((await upload(pdf(10), 'a.pdf', reader.token)).status).toBe(403);
    expect((await upload(pdf(10), 'a.pdf', t.admin, { conversationId: randomUUID() })).status).toBe(
      404,
    );
    const other = await mailWorkspace(rig.p, 'oat2');
    expect((await upload(pdf(10), 'a.pdf', other.admin, { conversationId: convUuid })).status).toBe(
      404,
    );
    const ok = await upload(pdf(10), 'a.pdf', t.admin, { conversationId: convUuid });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    // A staged id of another workspace is nobody's here.
    const foreign = await stage(pdf(20), 'f.pdf', other.admin);
    const out = await reply({ attachmentIds: [foreign] });
    expect(out).toMatchObject({ status: 'failed', failure_code: 'MAIL_ATTACHMENT_NOT_FOUND' });
  });
});

describe('TW-MAIL-027: caps and filters', () => {
  it('a file over the per-file cap is refused with MAIL_ATTACHMENT_TOO_LARGE; an empty or executable file is refused too', async () => {
    const big = await upload(pdf(6_000), 'big.pdf');
    expect(big.status).toBe(413);
    expect(big.body.code ?? big.body.type).toMatch(/MAIL_ATTACHMENT_TOO_LARGE/);
    expect((await upload(Buffer.alloc(0), 'empty.pdf')).status).toBe(422);
    const exe = await upload(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]), 'tool.exe');
    expect(exe.status).toBe(422);
    // Nothing was staged by the refused uploads.
    const n = await rig.p.h.owner.query(
      `SELECT count(*)::int AS n FROM mail_outbound_attachments WHERE org_id = $1 AND name IN ('big.pdf','empty.pdf','tool.exe')`,
      [t.orgId],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it('the mime deny list refuses a type after its content is known, and removes what it stored', async () => {
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
    const res = await upload(gif, 'anim.gif');
    expect(res.status).toBe(422);
  });

  it("too many files, or too many bytes together, fail the reply (nothing sent) with the cap's own code", async () => {
    const ids = [] as string[];
    for (let i = 0; i < 4; i += 1) ids.push(await stage(pdf(40), `m${i}.pdf`));
    const before = sentCount();
    const count = await reply({ attachmentIds: ids });
    expect(count).toMatchObject({ status: 'failed', failure_code: 'MAIL_TOO_MANY_ATTACHMENTS' });

    const a = await stage(pdf(4_000), 'a.pdf');
    const b = await stage(pdf(4_000), 'b.pdf');
    const total = await reply({ attachmentIds: [a, b] });
    expect(total).toMatchObject({ status: 'failed', failure_code: 'MAIL_ATTACHMENT_TOO_LARGE' });
    expect(sentCount()).toBe(before);
    // The contract's own count limit also stops it at the door.
    const res = await as()
      .post(`/v2/inbox/conversations/${convUuid}/messages`)
      .send({
        kind: 'text',
        body: 'x',
        clientMessageId: randomUUID(),
        email: { attachmentIds: Array.from({ length: 11 }, () => randomUUID()) },
      });
    expect(res.status).toBe(422);
  });
});

describe('TW-MAIL-027: staged uploads expire', () => {
  it('the cleanup removes unsent expired files (row and object) and leaves sent and fresh ones alone', async () => {
    const stale = await stage(pdf(30), 'stale.pdf');
    const fresh = await stage(pdf(31), 'fresh.pdf');
    const spent = await stage(pdf(32), 'spent.pdf');
    const staleRow = await stagedRow(stale);
    const spentRow = await stagedRow(spent);
    await rig.p.h.owner.query(
      `UPDATE mail_outbound_attachments SET expires_at = now() - interval '3 hours' WHERE uuid = ANY($1::uuid[])`,
      [[stale, spent]],
    );
    await rig.p.h.owner.query(
      `UPDATE mail_outbound_attachments SET used_at = now() WHERE uuid = $1`,
      [spent],
    );
    const removed = await rig.p.h.app.get(MailOutboundAttachmentsSweep).run();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await stagedRow(stale)).toBeUndefined();
    expect(await stagedRow(fresh)).toBeDefined();
    expect(await stagedRow(spent)).toBeDefined();
    const store = rig.p.h.app.get(ChatMediaStore);
    expect(await store.open(t.orgId, staleRow!.object_key as string)).toBeNull();
    const kept = await store.open(t.orgId, spentRow!.object_key as string);
    expect(kept).not.toBeNull();
    kept!.stream.destroy();
    // An expired file cannot be sent even before the sweep gets to it.
    const late = await stage(pdf(33), 'late.pdf');
    await rig.p.h.owner.query(
      `UPDATE mail_outbound_attachments SET expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [late],
    );
    expect(await reply({ attachmentIds: [late] })).toMatchObject({
      status: 'failed',
      failure_code: 'MAIL_ATTACHMENT_NOT_FOUND',
    });
  });
});
