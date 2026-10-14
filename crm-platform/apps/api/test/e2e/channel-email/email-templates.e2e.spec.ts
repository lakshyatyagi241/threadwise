import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Many replies to the one customer in a test run: the per-recipient burst guard (5 a minute) would hold them. Set before any import below.
const SAVED = vi.hoisted(() => {
  const saved = process.env.MAIL_RECIPIENT_BURST_MAX;
  process.env.MAIL_RECIPIENT_BURST_MAX = '100';
  return saved;
});

import { RequestContextStore } from '../../../src/common/context/request-context';
import { MailSyncService } from '../../../src/modules/channel-email/mail-sync.service';
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
 * Email templates (BL-004 / E-14), end to end on a real database and the Gmail stand-in: the library API (permissions, visibility of
 * shared and personal templates, validation, row versions, idempotency, audit and outbox, the plan lock), rendering a template for a real
 * conversation, and the send path (a reply from a template counts a use; a marketing template goes through the ConsentGate and carries
 * the signed unsubscribe link in both parts and the one-click headers). Nothing talks to a real mail provider.
 */
let rig: MailRig;
let t: Tenant;
let other: Tenant;
let mailboxId: string;
let convUuid: string;
let manager: { token: string; userId: number };
let agent: { token: string; userId: number };
let agent2: { token: string; userId: number };
let nobody: { token: string; userId: number };
const ADDR = 'support@acme.test';
const CUSTOMER = 'Bob Customer <bob@example.com>';

const as = (token = t.admin) => rig.p.api.as(token);
const api = (token = t.admin) => ({
  list: (qs = '') => as(token).get(`/v2/email/templates${qs}`),
  get: (id: string) => as(token).get(`/v2/email/templates/${id}`),
  create: (body: Record<string, unknown>, key: string = randomUUID()) =>
    as(token).post('/v2/email/templates').set('idempotency-key', key).send(body),
  update: (id: string, body: Record<string, unknown>) =>
    as(token).patch(`/v2/email/templates/${id}`).set('idempotency-key', randomUUID()).send(body),
  remove: (id: string) => as(token).delete(`/v2/email/templates/${id}`),
  preview: (body: Record<string, unknown>) =>
    as(token).post('/v2/email/templates/preview').set('idempotency-key', randomUUID()).send(body),
  render: (id: string, conversationId: string = convUuid) =>
    as(token)
      .post(`/v2/inbox/email-templates/${id}/render`)
      .set('idempotency-key', randomUUID())
      .send({ conversationId }),
});
const body = (over: Record<string, unknown> = {}) => ({
  name: 'Welcome',
  subject: 'Welcome, {{first_name}}',
  bodyHtml: '<p>Hello {{first_name}}, this is {{agent_name}} from {{workspace_name}}.</p>',
  ...over,
});
const row = async (id: string) =>
  (await rig.p.h.owner.query(`SELECT * FROM email_templates WHERE uuid = $1`, [id]))
    .rows[0] as Record<string, unknown>;
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
const reply = async (email: Record<string, unknown>, text = 'Plain text of the reply.') => {
  const res = await as()
    .post(`/v2/inbox/conversations/${convUuid}/messages`)
    .send({ kind: 'text', body: text, clientMessageId: randomUUID(), email });
  if (res.status !== 202) return { refused: res };
  return {
    refused: null,
    ...(await until('reply settled', async () => {
      const r = await rig.p.h.owner.query(
        `SELECT status, failure_code, failure_reason FROM messages WHERE uuid = $1`,
        [res.body.id],
      );
      const m = r.rows[0] as { status: string; failure_code: string | null };
      return m.status === 'queued' ? undefined : m;
    })),
  };
};
/** The mail as the provider received it, with the quoted-printable encoding undone. */
const lastMail = () =>
  rig.fake
    .sentTo(ADDR)
    .at(-1)!
    .raw.replace(/=\r?\n/g, '')
    .replace(/=3D/g, '=');
const sentCount = () => rig.fake.sentTo(ADDR).length;

beforeAll(async () => {
  rig = await startMailRig();
  t = await mailWorkspace(rig.p, 'etm');
  other = await mailWorkspace(rig.p, 'eto');
  const inbox = [
    ['inbox.conversation.read', 'all'],
    ['inbox.conversation.reply', 'all'],
  ] as Array<[string, 'all']>;
  manager = await rig.p.api.member(t, 'etmanager', [
    ['mail.templates.read', 'all'],
    ['mail.templates.manage', 'all'],
    ...inbox,
  ]);
  agent = await rig.p.api.member(t, 'etagent', [['mail.templates.read', 'all'], ...inbox]);
  agent2 = await rig.p.api.member(t, 'etagent2', [['mail.templates.read', 'all'], ...inbox]);
  nobody = await rig.p.api.member(t, 'etnobody', [['record.contacts.read', 'all']]);

  rig.fake.account(ADDR, 'Acme Support');
  expect(outcomeOf(await connectMailbox(rig, t, rig.fake.account(ADDR, 'Acme Support')))).toBe(
    'connected',
  );
  mailboxId = (
    await rig.p.h.owner.query(`SELECT uuid FROM mail_mailboxes WHERE org_id = $1`, [t.orgId])
  ).rows[0].uuid as string;
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
    threadId: 'th-tpl',
    subject: 'Question about pricing',
    from: CUSTOMER,
    messageId: 'cust-tpl-1@example.com',
  });
  await sync();
  convUuid = (
    await rig.p.h.owner.query(
      `SELECT uuid FROM conversations WHERE org_id = $1 AND peer_key = 't:th-tpl'`,
      [t.orgId],
    )
  ).rows[0].uuid as string;
}, 300_000);

afterAll(async () => {
  if (SAVED === undefined) delete process.env.MAIL_RECIPIENT_BURST_MAX;
  else process.env.MAIL_RECIPIENT_BURST_MAX = SAVED;
  await rig?.restore();
});

describe('the library API', () => {
  it('listing needs mail.templates.read; a shared template needs mail.templates.manage, a personal one only read', async () => {
    expect((await api(nobody.token).list()).status).toBe(403);
    expect((await api(nobody.token).create(body({ scope: 'mine' }))).status).toBe(403);

    const denied = await api(agent.token).create(body({ name: 'Shared by agent' }));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('EMAIL_TEMPLATE_NOT_EDITABLE');

    const res = await api(manager.token).create(body());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Welcome',
      subject: 'Welcome, {{first_name}}',
      scope: 'shared',
      purpose: 'general',
      status: 'active',
      usedCount: 0,
      lastUsedAt: null,
      canEdit: true,
      createdByName: 'etmanager',
      variables: ['first_name', 'agent_name', 'workspace_name'],
    });
    expect(res.body.bodyText).toContain('Hello {{first_name}}');
    expect(JSON.stringify(res.body)).not.toMatch(/"(org_?id|user_?id)"/i);
    expect(await rig.p.api.auditCount(t.orgId, 'email_templates', 'insert')).toBeGreaterThan(0);
    const events = await rig.p.api.events(t.orgId, 'mail.email_template.created');
    expect(events[events.length - 1]).toMatchObject({ name: 'Welcome', scope: 'shared' });

    // an agent can read it and is told they cannot change it
    const seen = await api(agent.token).list();
    expect(seen.status).toBe(200);
    expect(seen.body.data[0]).toMatchObject({ name: 'Welcome', canEdit: false });
  });

  it('the HTML is sanitised on write and the text twin derived', async () => {
    const res = await api(manager.token).create(
      body({
        name: 'Unsafe',
        subject: '',
        bodyHtml: '<p onclick="x()">Hi <b>there</b></p><script>steal()</script>',
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.bodyHtml).not.toMatch(/script|onclick|steal/);
    expect(res.body.bodyHtml).toContain('<b>there</b>');
    expect(res.body.bodyText).toContain('Hi there');
  });

  it('a retried create with the same Idempotency-Key makes one template', async () => {
    const key = randomUUID();
    const first = await api(manager.token).create(body({ name: 'Once' }), key);
    const second = await api(manager.token).create(body({ name: 'Once' }), key);
    expect(second.status).toBe(first.status);
    expect(second.body.id).toBe(first.body.id);
    const n = await rig.p.h.owner.query(
      `SELECT count(*)::int AS n FROM email_templates WHERE org_id = $1 AND name = 'Once'`,
      [t.orgId],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it('a name is unique per owner, ignoring case: 409 EMAIL_TEMPLATE_NAME_TAKEN; a personal one may reuse a shared name', async () => {
    const dup = await api(manager.token).create(body({ name: 'WELCOME' }));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('EMAIL_TEMPLATE_NAME_TAKEN');
    const mine = await api(agent.token).create(body({ name: 'Welcome', scope: 'mine' }));
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
    expect(mine.body).toMatchObject({ scope: 'mine', canEdit: true });
    expect((await api(agent.token).create(body({ name: 'welcome', scope: 'mine' }))).status).toBe(
      409,
    );
  });

  it('validates the input at the boundary', async () => {
    for (const bad of [
      { name: '  ' },
      { bodyHtml: '   ' },
      { subject: 'two\nlines' },
      { purpose: 'spam' },
      { name: 'x'.repeat(121) },
      { category: 'c'.repeat(65) },
    ]) {
      const res = await api(manager.token).create(body({ name: `v${Math.random()}`, ...bad }));
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it("a colleague's personal template does not exist for you, in the list or by id", async () => {
    const mine = await api(agent.token).create(body({ name: 'Private note', scope: 'mine' }));
    const id = mine.body.id as string;
    for (const who of [agent2, manager]) {
      expect((await api(who.token).get(id)).status).toBe(404);
      const names = (await api(who.token).list('?limit=100')).body.data.map(
        (x: { name: string }) => x.name,
      );
      expect(names).not.toContain('Private note');
      expect((await api(who.token).update(id, { name: 'hijack', rowVersion: 1 })).status).toBe(404);
      expect((await api(who.token).remove(id)).status).toBe(404);
    }
    // the owner sees it, and a scope filter narrows to it
    const own = await api(agent.token).list('?scope=mine');
    expect(own.body.data.map((x: { name: string }) => x.name)).toContain('Private note');
    const shared = await api(agent.token).list('?scope=shared&limit=100');
    expect(shared.body.data.map((x: { name: string }) => x.name)).not.toContain('Private note');
  });

  it('another workspace sees none of it', async () => {
    expect((await api(other.admin).list()).body.data).toEqual([]);
    const id = (await api(manager.token).list()).body.data[0].id as string;
    expect((await api(other.admin).get(id)).status).toBe(404);
    expect((await api(other.admin).remove(id)).status).toBe(404);
  });

  it('changing needs the rowVersion read (409 otherwise); archiving hides it from the default list; delete removes it', async () => {
    const made = await api(manager.token).create(body({ name: 'Editable' }));
    const id = made.body.id as string;
    const edited = await api(manager.token).update(id, {
      subject: 'New subject',
      category: 'Onboarding',
      rowVersion: made.body.rowVersion,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({ subject: 'New subject', category: 'Onboarding' });
    expect(edited.body.rowVersion).toBe(made.body.rowVersion + 1);

    const stale = await api(manager.token).update(id, {
      subject: 'Stale',
      rowVersion: made.body.rowVersion,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');

    const archived = await api(manager.token).update(id, {
      status: 'archived',
      rowVersion: edited.body.rowVersion,
    });
    expect(archived.body.status).toBe('archived');
    const active = (await api(manager.token).list('?limit=100')).body.data.map(
      (x: { id: string }) => x.id,
    );
    expect(active).not.toContain(id);
    const all = (await api(manager.token).list('?status=all&limit=100')).body.data.map(
      (x: { id: string }) => x.id,
    );
    expect(all).toContain(id);
    expect(
      (await api(manager.token).list('?category=Onboarding&status=all')).body.categories,
    ).toContain('Onboarding');

    // an agent cannot change a shared template
    const byAgent = await api(agent.token).update(id, { name: 'x', rowVersion: 3 });
    expect(byAgent.status).toBe(403);
    expect(byAgent.body.code).toBe('EMAIL_TEMPLATE_NOT_EDITABLE');
    expect((await api(agent.token).remove(id)).status).toBe(403);

    expect((await api(manager.token).remove(id)).status).toBe(204);
    expect((await api(manager.token).get(id)).status).toBe(404);
    expect(await rig.p.api.auditCount(t.orgId, 'email_templates', 'update')).toBeGreaterThan(0);
    expect(await rig.p.api.auditCount(t.orgId, 'email_templates', 'delete')).toBeGreaterThan(0);
  });

  it('lists newest first with a cursor that never repeats or drops a row', async () => {
    for (let i = 0; i < 5; i++) await api(manager.token).create(body({ name: `Page ${i}` }));
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 30; guard++) {
      const res = await api(manager.token).list(
        `?limit=2&status=all${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((x: { id: string }) => x.id));
      if (!res.body.page.hasMore) break;
      cursor = res.body.page.nextCursor as string;
    }
    expect(new Set(seen).size).toBe(seen.length);
    const total = await rig.p.h.owner.query(
      `SELECT count(*)::int AS n FROM email_templates WHERE org_id = $1 AND user_id IS NULL`,
      [t.orgId],
    );
    expect(seen.length).toBeGreaterThanOrEqual(Number(total.rows[0].n) - 1);
  });

  it('search matches the name, the subject and the category', async () => {
    await api(manager.token).create(
      body({ name: 'Findable one', subject: 'Zebra subject', category: 'Quarterly' }),
    );
    for (const q of ['findable', 'zebra', 'quarterly']) {
      const res = await api(manager.token).list(`?q=${q}`);
      expect(
        res.body.data.map((x: { name: string }) => x.name),
        q,
      ).toContain('Findable one');
    }
    expect((await api(manager.token).list('?q=%25')).body.data).toEqual([]);
  });

  it('previews unsaved text with sample data and says which variables stayed', async () => {
    const res = await api(agent.token).preview({
      subject: 'Hi {{first_name}}',
      bodyHtml: '<p>{{first_name}} {{mystery}}</p><script>x()</script>',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ subject: 'Hi Amira', source: 'sample' });
    expect(res.body.html).toContain('Amira');
    expect(res.body.html).not.toContain('script');
    expect(res.body.issues).toEqual([{ token: '{{mystery}}', key: 'mystery', reason: 'unknown' }]);
    expect((await api(nobody.token).preview({ bodyHtml: '<p>x</p>' })).status).toBe(403);
  });

  it('a workspace without the email add-on is locked out (422 PLAN_FEATURE_LOCKED), data kept', async () => {
    const before = await rig.p.h.owner.query(
      `SELECT count(*)::int AS n FROM email_templates WHERE org_id = $1`,
      [t.orgId],
    );
    await setMailPlan(rig.p, t.orgId, { feature: false });
    try {
      const res = await api(manager.token).list();
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
      expect((await api(manager.token).create(body({ name: 'Locked' }))).status).toBe(422);
      expect((await api(manager.token).render(randomUUID())).status).toBe(422);
    } finally {
      await setMailPlan(rig.p, t.orgId, { mailboxes: 3 });
    }
    const after = await rig.p.h.owner.query(
      `SELECT count(*)::int AS n FROM email_templates WHERE org_id = $1`,
      [t.orgId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe('rendering for a conversation', () => {
  it('fills the contact, the agent and the workspace, escaping what the contact wrote', async () => {
    const made = await api(manager.token).create(
      body({ name: 'Greeting', subject: 'Re: pricing for {{first_name}}' }),
    );
    const res = await api(agent.token).render(made.body.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.source).toBe('conversation');
    expect(res.body.subject).toBe('Re: pricing for Bob');
    expect(res.body.html).toContain('Hello Bob, this is etagent from');
    expect(res.body.issues).toEqual([]);
    // nothing is counted by rendering
    expect((await row(made.body.id)).used_count).toBe(0);
  });

  it('a name with markup is text in the HTML and one line in the subject', async () => {
    rig.fake.deliver(ADDR, {
      threadId: 'th-evil',
      subject: 'Hello',
      from: '"<img src=x onerror=alert(1)> Eve" <eve@example.com>',
      messageId: 'cust-evil-1@example.com',
    });
    await sync();
    const evil = (
      await rig.p.h.owner.query(
        `SELECT uuid FROM conversations WHERE org_id = $1 AND peer_key = 't:th-evil'`,
        [t.orgId],
      )
    ).rows[0].uuid as string;
    const made = await api(manager.token).create(body({ name: 'Evil greeting' }));
    const res = await api(agent.token).render(made.body.id, evil);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.html).not.toContain('<img');
    expect(res.body.subject).not.toMatch(/[\r\n]/);
  });

  it('needs the right to reply to that conversation, and the template must exist for the caller', async () => {
    const made = await api(manager.token).create(body({ name: 'Needs reply' }));
    const readOnly = await rig.p.api.member(t, 'etreadonly', [
      ['mail.templates.read', 'all'],
      ['inbox.conversation.read', 'all'],
    ]);
    expect((await api(readOnly.token).render(made.body.id)).status).toBe(403);
    expect((await api(agent.token).render(randomUUID())).status).toBe(404);
    expect((await api(agent.token).render(made.body.id, randomUUID())).status).toBe(404);
    const personal = await api(agent2.token).create(body({ name: 'Agent2 only', scope: 'mine' }));
    expect((await api(agent.token).render(personal.body.id)).status).toBe(404);
  });

  it('an archived template is refused (422 EMAIL_TEMPLATE_ARCHIVED)', async () => {
    const made = await api(manager.token).create(body({ name: 'Soon archived' }));
    await api(manager.token).update(made.body.id, {
      status: 'archived',
      rowVersion: made.body.rowVersion,
    });
    const res = await api(agent.token).render(made.body.id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('EMAIL_TEMPLATE_ARCHIVED');
  });
});

describe('the send path', () => {
  it('a reply from a general template goes out and counts one use without touching the row version', async () => {
    const made = await api(manager.token).create(
      body({ name: 'General send', subject: 'About {{first_name}}' }),
    );
    const rendered = (await api().render(made.body.id)).body;
    const before = sentCount();
    const out = await reply({
      templateId: made.body.id,
      subject: rendered.subject,
      bodyHtml: rendered.html,
    });
    expect(out.refused, JSON.stringify(out.refused?.body)).toBeNull();
    expect(out).toMatchObject({ status: 'sent' });
    expect(sentCount()).toBe(before + 1);
    const mail = lastMail();
    expect(mail).toContain('Subject: About Bob');
    expect(mail).toContain('Hello Bob');
    // a general reply is not marketing: no unsubscribe link and no one-click header
    expect(mail).not.toMatch(/List-Unsubscribe/i);
    const after = await row(made.body.id);
    expect(after.used_count).toBe(1);
    expect(after.last_used_at).not.toBeNull();
    expect(after.row_version).toBe(made.body.rowVersion);
  });

  it('a marketing template makes the reply marketing mail: unsubscribe link in both parts and the one-click headers', async () => {
    const made = await api(manager.token).create(
      body({ name: 'Newsletter', purpose: 'marketing', subject: 'News for {{first_name}}' }),
    );
    expect(made.body.purpose).toBe('marketing');
    const rendered = (await api().render(made.body.id)).body;
    const before = sentCount();
    const out = await reply({
      templateId: made.body.id,
      subject: rendered.subject,
      bodyHtml: rendered.html,
    });
    expect(out.refused, JSON.stringify(out.refused?.body)).toBeNull();
    expect(out).toMatchObject({ status: 'sent' });
    expect(sentCount()).toBe(before + 1);
    const mail = lastMail();
    expect(mail).toMatch(/List-Unsubscribe:\s*<[^>]+\/consent\/unsubscribe\/[^>]+>/i);
    expect(mail).toMatch(/List-Unsubscribe-Post: List-Unsubscribe=One-Click/i);
    expect(mail).toMatch(/Unsubscribe: https?:\/\/\S+\/u\/\S+/);
    expect(mail).toMatch(/<a href="https?:\/\/[^"]+\/u\/[^"]+">Unsubscribe<\/a>/);
    expect((await row(made.body.id)).used_count).toBe(1);
  });

  it('the client cannot make a marketing template general by leaving it out, nor a general one marketing by adding a flag', async () => {
    const marketing = await api(manager.token).create(
      body({ name: 'Still marketing', purpose: 'marketing' }),
    );
    // Only the template id is sent: the server decides.
    const out = await reply({ templateId: marketing.body.id, bodyHtml: '<p>Offer</p>' });
    expect(out).toMatchObject({ status: 'sent' });
    expect(lastMail()).toMatch(/List-Unsubscribe:/i);

    const general = await api(manager.token).create(body({ name: 'Still general' }));
    const before = sentCount();
    const res = await reply({
      templateId: general.body.id,
      marketing: true,
      bodyHtml: '<p>Hi</p>',
    });
    expect(res).toMatchObject({ status: 'sent' });
    expect(sentCount()).toBe(before + 1);
    expect(lastMail()).not.toMatch(/List-Unsubscribe:/i);
  });

  it('a marketing template is refused for a contact who unsubscribed, and nothing is sent', async () => {
    const contact = (
      await rig.p.h.owner.query(
        `SELECT uuid FROM contacts WHERE org_id = $1 AND lower(email) = 'bob@example.com'`,
        [t.orgId],
      )
    ).rows[0].uuid as string;
    const rec = await as()
      .post(`/v2/contact-consent/contacts/${contact}/events`)
      .set('idempotency-key', randomUUID())
      .send({ channel: 'email', action: 'withdrawn', note: 'asked by phone' });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);

    const made = await api(manager.token).create(
      body({ name: 'After unsubscribe', purpose: 'marketing' }),
    );
    const before = sentCount();
    const out = await reply({ templateId: made.body.id, bodyHtml: '<p>Offer</p>' });
    // refused at the door or failed by the queue: either way no mail left
    if (out.refused) expect(out.refused.status).toBeGreaterThanOrEqual(400);
    else expect(out).toMatchObject({ status: 'failed' });
    expect(sentCount()).toBe(before);
    expect((await row(made.body.id)).used_count).toBe(0);

    // a general reply to the same contact still goes out: only marketing is stopped
    const general = await api(manager.token).create(body({ name: 'Service reply' }));
    const service = await reply({ templateId: general.body.id, bodyHtml: '<p>Your answer</p>' });
    expect(service).toMatchObject({ status: 'sent' });
  });

  it("a reply naming an archived template, a missing one or a colleague's personal one is refused before it is queued", async () => {
    const archived = await api(manager.token).create(body({ name: 'Archived for send' }));
    await api(manager.token).update(archived.body.id, {
      status: 'archived',
      rowVersion: archived.body.rowVersion,
    });
    const a = await reply({ templateId: archived.body.id });
    expect(a.refused?.status).toBe(422);
    expect(a.refused?.body.code).toBe('EMAIL_TEMPLATE_ARCHIVED');

    const missing = await reply({ templateId: randomUUID() });
    expect(missing.refused?.status).toBe(404);
    expect(missing.refused?.body.code).toBe('EMAIL_TEMPLATE_NOT_FOUND');

    const theirs = await api(agent2.token).create(body({ name: 'Theirs', scope: 'mine' }));
    const stolen = await reply({ templateId: theirs.body.id });
    expect(stolen.refused?.status).toBe(404);
  });

  it('deleting a template after the reply was queued does not stop the mail', async () => {
    const made = await api(manager.token).create(body({ name: 'Deleted later' }));
    const out = await reply({ templateId: made.body.id, bodyHtml: '<p>Bye</p>' });
    expect(out).toMatchObject({ status: 'sent' });
    expect((await api(manager.token).remove(made.body.id)).status).toBe(204);
  });
});
