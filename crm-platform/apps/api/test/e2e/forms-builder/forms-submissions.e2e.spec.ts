import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  MAIL_PORT,
  type MailPort,
} from '../../../src/infra/providers/auth-registration-security/mail.port';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
} from '../../../src/kernel/outbox/outbox-subscribers';
import { FormNotificationConsumer } from '../../../src/modules/forms-builder/form-notification.consumer';
import { FormRetentionSweepService } from '../../../src/modules/forms-builder/form-retention-sweep.service';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';
import { ConfigService } from '@nestjs/config';
import {
  FormsApi,
  contactDefinition,
  field,
  startHarness,
  SUBMISSIONS_READ,
  type Harness,
  type Tenant,
} from './support';

/**
 * The staff side of submissions against a real Postgres and Redis (docs/specs/forms-builder-app.md 7.1, 9.5 and 9.1 step 8): the list, the
 * answers (and the audit of opening them), record scope, retry, erase, the CSV export with its formula-injection guard, the retention
 * sweep and the notifications. Test names carry the rule they cover.
 */
let h: Harness;
let api: FormsApi;
let t: Tenant;
let seq = 0;
const fresh = (label = 's') => `${label}${Date.now().toString(36)}${seq++}@example.test`;

beforeAll(async () => {
  h = await startHarness();
  api = new FormsApi(h);
  t = await api.workspace('subs');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

async function liveForm(workspace: Tenant = t, body: Record<string, unknown> = {}) {
  return api.liveForm(workspace.admin, {
    settings: { rateLimits: { perContactPerHour: 100 } },
    ...body,
  });
}

describe('listing and opening submissions', () => {
  it('lists newest first with a preview of what the visitor gave, filters by tab, status, text and date, and pages by cursor', async () => {
    const w = await api.workspace('lst');
    const form = await liveForm(w);
    const emails: string[] = [];
    for (const [i, name] of ['Ada One', 'Bea Two', 'Cy Three'].entries()) {
      const email = fresh('lst');
      emails.push(email);
      expect(
        (await api.submit(form.publicKey, { answers: { name, email, phone: `98765 0000${i}` } }))
          .status,
      ).toBe(201);
    }
    await api.submit(form.publicKey, {
      answers: {
        name: 'Spammer',
        email: fresh('sp'),
        note: 'cheap backlinks and SEO services at https://a.example and https://b.example',
      },
    });
    const all = (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions`)).body;
    expect(all.data.map((s: { preview: { name: string } }) => s.preview.name)).toEqual([
      'Cy Three',
      'Bea Two',
      'Ada One',
    ]);
    expect(all.data[0]).toMatchObject({
      status: 'created',
      formId: form.id,
      formVersion: 1,
      preview: { email: emails[2], phone: '+919876500002' },
      contact: { name: 'Cy Three' },
      company: null,
      answersRemoved: false,
      consentGiven: null,
    });
    expect(JSON.stringify(all)).not.toMatch(/"id":\s*\d+/);
    const page1 = (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions?limit=2`)).body;
    expect(page1.page).toMatchObject({ hasMore: true, limit: 2 });
    const page2 = (
      await api
        .as(w.admin)
        .get(`/v2/forms/${form.id}/submissions?limit=2&cursor=${page1.page.nextCursor}`)
    ).body;
    expect(page2.data.map((s: { preview: { name: string } }) => s.preview.name)).toEqual([
      'Ada One',
    ]);
    expect(
      (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions?order=asc`)).body.data[0].preview
        .name,
    ).toBe('Ada One');
    expect(
      (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions?tab=spam`)).body.data.map(
        (s: { preview: { name: string } }) => s.preview.name,
      ),
    ).toEqual(['Spammer']);
    expect(
      (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions?status=created`)).body.data,
    ).toHaveLength(3);
    expect(
      (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions?tab=needs_attention`)).body.data,
    ).toEqual([]);
    expect(
      (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions?q=bea`)).body.data,
    ).toHaveLength(1);
    expect(
      (
        await api
          .as(w.admin)
          .get(`/v2/forms/${form.id}/submissions?q=${encodeURIComponent(emails[0]!)}`)
      ).body.data,
    ).toHaveLength(1);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      (
        await api
          .as(w.admin)
          .get(`/v2/forms/${form.id}/submissions?from=${encodeURIComponent(future)}`)
      ).body.data,
    ).toEqual([]);
    const contactId = all.data[1].contact.id as string;
    expect(
      (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions?contactId=${contactId}`)).body
        .data,
    ).toHaveLength(1);
    expect(
      (
        await api
          .as(w.admin)
          .get(`/v2/forms/${form.id}/submissions?contactId=3f2b8f0e-7c2a-4f0a-9a52-1d6c5a1e8b11`)
      ).body.data,
    ).toEqual([]);
  });

  it('opening a submission shows the answers with the label and kind of the version it was made against, and is audited; later edits never reinterpret old answers', async () => {
    const w = await api.workspace('det');
    const form = await liveForm(w);
    const email = fresh('det');
    await api.submit(
      form.publicKey,
      {
        answers: { name: 'Ada', email, note: 'Hello there' },
        hidden: {
          utm_source: 'google',
          utm_medium: 'cpc',
          referrer: 'https://ref.example/',
          page_url: 'https://site.example/p',
        },
      },
      { headers: { 'user-agent': 'UA/1' } },
    );
    const id = (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions`)).body.data[0]
      .id as string;
    // The form is edited and republished with different labels; the submission still reads against version 1.
    const def = contactDefinition();
    def.steps[0]!.blocks[1] = field('email', 'email', {
      label: 'Work email',
      required: true,
      bind: { object: 'contact', property: 'email' },
    });
    const edited = await api.patchForm(w.admin, form, { definition: def });
    await api.publish(w.admin, edited);
    const detail = (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions/${id}`)).body;
    expect(detail.formVersion).toBe(1);
    expect(
      detail.answers.map((a: { fieldId: string; label: string; kind: string }) => [
        a.fieldId,
        a.label,
        a.kind,
      ]),
    ).toEqual([
      ['name', 'name', 'short_text'],
      ['email', 'email', 'email'],
      ['note', 'note', 'long_text'],
    ]);
    expect(detail.answers[1].value).toBe(email);
    expect(detail.attribution).toEqual({
      utm: { utm_source: 'google', utm_medium: 'cpc' },
      referrer: 'https://ref.example/',
      pageUrl: 'https://site.example/p',
      userAgent: 'UA/1',
    });
    expect(detail).toMatchObject({ status: 'created', spamScore: 0, error: null, consent: null });
    const reads = Number(
      (
        await api.rows(
          w.orgId,
          `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'web_form_submissions' AND action = 'read'`,
        )
      )[0]!.n,
    );
    expect(reads).toBe(1);
    await api.as(w.admin).get(`/v2/forms/${form.id}/submissions/${id}`);
    expect(
      Number(
        (
          await api.rows(
            w.orgId,
            `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND action = 'read' AND actor_id = $2`,
            [w.adminUserId],
          )
        )[0]!.n,
      ),
    ).toBe(2);
    // The list is not an "open": it does not write an audit row per row.
    await api.as(w.admin).get(`/v2/forms/${form.id}/submissions`);
    expect(
      Number(
        (
          await api.rows(
            w.orgId,
            `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND action = 'read'`,
          )
        )[0]!.n,
      ),
    ).toBe(2);
    expect(
      (
        await api
          .as(w.admin)
          .get(`/v2/forms/${form.id}/submissions/3f2b8f0e-7c2a-4f0a-9a52-1d6c5a1e8b11`)
      ).status,
    ).toBe(404);
  });

  it('permissions: reading needs record.form-submissions.read, retry needs update, erase needs delete, export needs export', async () => {
    const form = await liveForm();
    await api.submit(form.publicKey, { answers: { name: 'Perm', email: fresh('perm') } });
    const sid = (await api.as(t.admin).get(`/v2/forms/${form.id}/submissions`)).body.data[0]
      .id as string;
    const formsOnly = await api.member(t, 'formsonly', [['record.forms.read']]);
    expect((await api.as(formsOnly.token).get(`/v2/forms/${form.id}/submissions`)).status).toBe(
      403,
    );
    const reader = await api.member(t, 'subreader', SUBMISSIONS_READ);
    expect((await api.as(reader.token).get(`/v2/forms/${form.id}/submissions`)).status).toBe(200);
    expect((await api.as(reader.token).get(`/v2/forms/${form.id}/submissions/${sid}`)).status).toBe(
      200,
    );
    expect(
      (await api.as(reader.token).post(`/v2/forms/${form.id}/submissions/export`).send({})).status,
    ).toBe(403);
    expect(
      (await api.as(reader.token).post(`/v2/forms/${form.id}/submissions/${sid}/retry`).send({}))
        .status,
    ).toBe(403);
    expect(
      (await api.as(reader.token).delete(`/v2/forms/${form.id}/submissions/${sid}`)).status,
    ).toBe(403);
    const exporter = await api.member(t, 'exporter', [['record.form-submissions.export']]);
    expect(
      (await api.as(exporter.token).post(`/v2/forms/${form.id}/submissions/export`).send({}))
        .status,
    ).toBe(200);
  });

  it('record scope `own`: a member sees the submissions of the forms they made and of the contacts they own, nothing else', async () => {
    const w = await api.workspace('scp');
    const mine = await api.member(w, 'scoped', [
      ['record.form-submissions.read', 'own'],
      ['record.forms.read', 'own'],
      ['record.forms.create', 'all'],
      ['record.forms.update', 'own'],
    ]);
    const adminForm = await liveForm(w);
    const myForm = await api.liveForm(mine.token, {
      settings: { rateLimits: { perContactPerHour: 100 } },
    });
    await api.submit(adminForm.publicKey, {
      answers: { name: 'On admin form', email: fresh('own1') },
    });
    await api.submit(adminForm.publicKey, {
      answers: { name: 'Mine by contact', email: 'mine@x.test' },
    });
    await api.submit(myForm.publicKey, { answers: { name: 'On my form', email: fresh('own2') } });
    // Hand one of the contacts on the admin's form to the member: its submission becomes visible to them.
    await h.owner.query(
      `UPDATE contacts SET owner_id = $2 WHERE org_id = $1 AND normalized_email = 'mine@x.test'`,
      [w.orgId, mine.userId],
    );
    const onAdmin = (
      await api.as(mine.token).get(`/v2/forms/${adminForm.id}/submissions`)
    ).body.data.map((s: { preview: { name: string } }) => s.preview.name);
    expect(onAdmin).toEqual(['Mine by contact']);
    const onMine = (
      await api.as(mine.token).get(`/v2/forms/${myForm.id}/submissions`)
    ).body.data.map((s: { preview: { name: string } }) => s.preview.name);
    expect(onMine).toEqual(['On my form']);
    const hidden = (
      await api
        .as(w.admin)
        .get(`/v2/forms/${adminForm.id}/submissions?q=${encodeURIComponent('On admin form')}`)
    ).body.data[0].id as string;
    expect(
      (await api.as(mine.token).get(`/v2/forms/${adminForm.id}/submissions/${hidden}`)).status,
    ).toBe(404);
    expect(
      (await api.as(w.admin).get(`/v2/forms/${adminForm.id}/submissions`)).body.data,
    ).toHaveLength(2);
  });
});

describe('retry and erase (spec 7.1 and 9.5)', () => {
  it("retry re-runs a needs_review or failed submission under the form's CURRENT mapping; any other status is 409 FORMS_SUBMISSION_NOT_RETRYABLE", async () => {
    const w = await api.workspace('rty');
    // A form whose email field is NOT mapped to the contact's email (a mistake the owner fixes later) and which got no phone.
    const def = {
      title: 'T',
      steps: [
        {
          id: 'main',
          blocks: [
            field('name', 'short_text', { bind: { object: 'contact', property: 'name' } }),
            field('mail', 'email', { required: true }),
            field('phone', 'phone', { bind: { object: 'contact', property: 'phone' } }),
          ],
        },
      ],
    };
    const form = await api.liveForm(w.admin, {
      definition: def,
      settings: { rateLimits: { perContactPerHour: 100 } },
    });
    const email = fresh('rty');
    await api.submit(form.publicKey, { answers: { name: 'Held', mail: email } });
    const held = (await api.submissions(w.orgId, form.id))[0]!;
    expect(held).toMatchObject({ status: 'needs_review', reason: 'no_contact_point' });
    // The owner maps the email field to the contact's email, republishes; the held submission now has a contact point.
    const fixed = {
      ...def,
      steps: [
        {
          id: 'main',
          blocks: [
            def.steps[0]!.blocks[0],
            field('mail', 'email', {
              required: true,
              bind: { object: 'contact', property: 'email' },
            }),
            def.steps[0]!.blocks[2],
          ],
        },
      ],
    };
    const edited = await api.patchForm(w.admin, form, { definition: fixed });
    await api.publish(w.admin, edited);
    const retried = await api
      .as(w.admin)
      .post(`/v2/forms/${form.id}/submissions/${held.uuid}/retry`)
      .send({});
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body).toMatchObject({
      status: 'created',
      reason: null,
      contact: { name: 'Held' },
    });
    expect((await api.contactByEmail(w.orgId, email))!.name).toBe('Held');
    expect(await api.contactCount(w.orgId)).toBe(1);
    expect(
      Number(
        (
          await api.rows(
            w.orgId,
            `SELECT count(*)::int AS n FROM contact_attributions WHERE org_id = $1`,
          )
        )[0]!.n,
      ),
    ).toBe(1);
    const again = await api
      .as(w.admin)
      .post(`/v2/forms/${form.id}/submissions/${held.uuid}/retry`)
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('FORMS_SUBMISSION_NOT_RETRYABLE');
    expect(await api.eventsOfType(w.orgId, 'form.submitted')).toHaveLength(1);
  });

  it('erase removes the answers and what identifies the visitor, keeps a tombstone with its outcome and consent, never touches the contact, and cannot be retried', async () => {
    const w = await api.workspace('ers');
    const form = await api.liveForm(w.admin, {
      definition: contactDefinition({
        consent: { enabled: true, text: 'I agree', required: true, marketing: false },
      }),
      settings: { rateLimits: { perContactPerHour: 100 } },
    });
    const email = fresh('ers');
    await api.submit(form.publicKey, {
      answers: { name: 'Gone', email, note: 'private note' },
      consent: { given: true, textVersion: 1 },
      hidden: { utm_source: 'x', referrer: 'https://r.example/' },
    });
    const sub = (await api.submissions(w.orgId, form.id))[0]!;
    const del = await api.as(w.admin).delete(`/v2/forms/${form.id}/submissions/${sub.uuid}`);
    expect(del.status).toBe(204);
    const row = (await api.submissions(w.orgId, form.id))[0]!;
    expect(row).toMatchObject({
      status: 'created',
      answers: {},
      utm: {},
      referrer: null,
      page_url: null,
      user_agent: null,
      ip_hash: null,
    });
    expect(row.erased_at).toBeTruthy();
    expect(row.consent).toMatchObject({ given: true, text: 'I agree' });
    expect(Number(row.contact_id)).toBeGreaterThan(0);
    expect(await api.contactByEmail(w.orgId, email)).toBeTruthy();
    const detail = (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions/${sub.uuid}`)).body;
    expect(detail).toMatchObject({ answersRemoved: true, answers: [], consent: { given: true } });
    expect(JSON.stringify(detail)).not.toContain('private note');
    expect(await api.auditCount(w.orgId, 'web_form_submissions', 'delete')).toBe(1);
    expect(await api.eventsOfType(w.orgId, 'form.submission_erased')).toHaveLength(1);
    const keep = await api.rows(
      w.orgId,
      `SELECT 1 FROM web_form_submissions WHERE org_id = $1 AND uuid = $2::uuid`,
      [sub.uuid],
    );
    expect(keep).toHaveLength(1);
  });
});

describe('export (spec 7.1 and 14)', () => {
  it('a CSV with one column per field, newest first, every cell safe to open in a spreadsheet, audited, honouring the filters', async () => {
    const w = await api.workspace('exp');
    const form = await liveForm(w);
    await api.submit(form.publicKey, {
      answers: {
        name: '=HYPERLINK("http://evil.example","click")',
        email: fresh('x1'),
        note: 'line one\nline "two", with comma',
      },
    });
    await api.submit(form.publicKey, { answers: { name: '+cmd|calc', email: fresh('x2') } });
    await api.submit(form.publicKey, { answers: { name: '@SUM(1)', email: fresh('x3') } });
    await api.submit(form.publicKey, {
      answers: { name: 'Plain', email: fresh('x4'), company: 'Acme', website: 'acme.com' },
    });
    const res = await api.as(w.admin).post(`/v2/forms/${form.id}/submissions/export`).send({});
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="[a-z0-9-]+-submissions\.csv"$/,
    );
    expect(res.headers['x-export-truncated']).toBe('false');
    expect(res.headers['x-export-rows']).toBe('4');
    expect(res.headers['cache-control']).toContain('no-store');
    const text = res.text;
    const lines = text.split('\r\n');
    expect(lines[0]).toBe(
      'Submission ID,Submitted at,Status,Reason,Form version,Contact,Company,UTM source,UTM medium,UTM campaign,Referrer,Page URL,Consent given,name,email,phone,company,website,note',
    );
    expect(lines[1]).toContain(',Plain,');
    expect(text).toContain('"\'=HYPERLINK(""http://evil.example"",""click"")"');
    expect(text).toContain(",'+cmd|calc,");
    expect(text).toContain(",'@SUM(1),");
    expect(text).toContain('"line one\nline ""two"", with comma"');
    for (const row of lines.slice(1).filter(Boolean)) {
      // No cell of the fixed or answer columns starts a formula.
      expect(row.split(',').some((c) => /^[=+@]/.test(c))).toBe(false);
    }
    expect(
      Number(
        (
          await api.rows(
            w.orgId,
            `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND action = 'export'`,
          )
        )[0]!.n,
      ),
    ).toBe(1);
    const filtered = await api
      .as(w.admin)
      .post(`/v2/forms/${form.id}/submissions/export`)
      .send({ status: 'needs_review' });
    expect(filtered.text.split('\r\n').filter(Boolean)).toHaveLength(1);
    expect(filtered.headers['x-export-rows']).toBe('0');
    expect(
      (
        await api
          .as(w.admin)
          .post(`/v2/forms/${form.id}/submissions/export`)
          .send({ status: 'bogus' })
      ).status,
    ).toBe(422);
  });

  it('after the form changed, the export carries the columns of every version the rows were made against', async () => {
    const w = await api.workspace('exp2');
    const form = await liveForm(w);
    await api.submit(form.publicKey, {
      answers: { name: 'V1', email: fresh('v1'), note: 'old note' },
    });
    const def = contactDefinition();
    def.steps[0]!.blocks = def.steps[0]!.blocks.filter((b) => (b as { id: string }).id !== 'note');
    def.steps[0]!.blocks.push(field('size', 'number', {}));
    const v2 = await api.publish(w.admin, await api.patchForm(w.admin, form, { definition: def }));
    expect(v2.publishedVersion).toBe(2);
    await api.submit(form.publicKey, { answers: { name: 'V2', email: fresh('v2'), size: 7 } });
    const csv = (
      await api.as(w.admin).post(`/v2/forms/${form.id}/submissions/export`).send({})
    ).text.split('\r\n');
    expect(csv[0]!.split(',').slice(13)).toEqual([
      'name',
      'email',
      'phone',
      'company',
      'website',
      'size',
      'note',
    ]);
    expect(csv[1]).toContain(',2,');
    expect(csv[2]).toContain(',1,');
  });
});

describe('retention and notifications (worker side)', () => {
  it('the daily sweep empties the answers of submissions past their retention (and what identifies the visitor), keeps the row, outcome and consent, and leaves the rest alone', async () => {
    const w = await api.workspace('ret');
    const form = await liveForm(w);
    await api.submit(
      form.publicKey,
      { answers: { name: 'Old', email: fresh('old'), note: 'keep for now' } },
      { headers: { 'user-agent': 'UA/9' } },
    );
    await api.submit(form.publicKey, { answers: { name: 'Fresh', email: fresh('new') } });
    const rows = await api.submissions(w.orgId, form.id);
    await h.owner.query(
      `UPDATE web_form_submissions SET answers_expires_at = now() - interval '1 day' WHERE org_id = $1 AND id = $2`,
      [w.orgId, rows[0]!.id],
    );
    await h.owner.query(
      `INSERT INTO web_form_events (org_id, form_id, visit_id, kind, created_at) VALUES ($1,$2,'visit-ancient','view', now() - interval '100 days')`,
      [w.orgId, rows[0]!.form_id],
    );
    const sweep = new FormRetentionSweepService(h.app.get(DatabaseService));
    expect(await sweep.sweepAnswers()).toBe(1);
    expect(await sweep.sweepAnswers()).toBe(0);
    expect(await sweep.sweepEvents()).toBe(1);
    const after = await api.submissions(w.orgId, form.id);
    expect(after[0]).toMatchObject({
      answers: {},
      user_agent: null,
      ip_hash: null,
      status: 'created',
    });
    expect(after[0]!.payload_purged_at).toBeTruthy();
    expect(Number(after[0]!.contact_id)).toBeGreaterThan(0);
    expect(after[1]!.answers).toMatchObject({ name: 'Fresh' });
    const list = (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions`)).body.data;
    expect(
      list.find((s: { preview: { name: string | null } }) => s.preview.name === null),
    ).toMatchObject({ answersRemoved: true });
    const retry = await api
      .as(w.admin)
      .post(`/v2/forms/${form.id}/submissions/${after[0]!.uuid}/retry`)
      .send({});
    expect(retry.status).toBe(409);
    // "Keep forever" never expires.
    const forever = await liveForm(w, { settings: { retentionDays: null } });
    await api.submit(forever.publicKey, { answers: { name: 'Forever', email: fresh('fv') } });
    expect((await api.submissions(w.orgId, forever.id))[0]!.answers_expires_at).toBeNull();
  });

  describe('notifications', () => {
    const mailbox = (): Array<{ to: string; subject: string; text: string }> => h.mail;
    let registry: OutboxSubscriberRegistry;
    let consumer: FormNotificationConsumer;

    beforeAll(() => {
      registry = new OutboxSubscriberRegistry();
      consumer = new FormNotificationConsumer(
        h.app.get(DatabaseService),
        new NotificationsRepository(),
        registry,
        h.redis,
        h.app.get(ConfigService),
        h.app.get<MailPort>(MAIL_PORT, { strict: false }),
      );
      consumer.onModuleInit();
    });

    /** What the worker's drain loop does for one workspace: every form event in the outbox goes to the registry. */
    async function deliver(orgId: number): Promise<void> {
      const res = await h.owner.query(
        `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
         WHERE org_id = $1 AND event_type IN ('form.submitted', 'form.needs_review') ORDER BY id`,
        [orgId],
      );
      for (const r of res.rows) {
        const event: OutboxEvent = {
          id: String(r.id),
          orgId: Number(r.org_id),
          aggregateModule: r.aggregate_module,
          aggregateId: String(r.aggregate_id),
          eventType: r.event_type,
          payload: r.payload,
        };
        await registry.dispatch(event);
      }
    }
    const notes = (orgId: number, userId: number) =>
      api.rows(
        orgId,
        `SELECT * FROM inbox_notifications WHERE org_id = $1 AND user_id = $2 ORDER BY id`,
        [userId],
      );

    it('tells the owner and the listed users in-app once per submission, and emails the listed addresses once, with a name and a link and no answers', async () => {
      const w = await api.workspace('ntf');
      const owner = await api.member(w, 'owner', [['record.contacts.read']]);
      const watcher = await api.member(w, 'watcher', [['record.contacts.read']]);
      const bystander = await api.member(w, 'bystander', [['record.contacts.read']]);
      const ownerUuid = await api.userUuid(owner.userId);
      const form = await api.liveForm(w.admin, {
        settings: {
          ownerRule: { mode: 'fixed', userIds: [ownerUuid] },
          notify: {
            owner: true,
            userIds: [await api.userUuid(watcher.userId)],
            emails: ['Boss@Example.com', 'ops@example.com'],
          },
          rateLimits: { perContactPerHour: 100 },
        },
      });
      await api.submit(form.publicKey, {
        answers: { name: 'Ada <b>Lovelace</b>', email: fresh('ntf'), note: 'my secret request' },
      });
      const sub = (await api.submissions(w.orgId, form.id))[0]!;
      await deliver(w.orgId);
      await deliver(w.orgId); // redelivery: at-least-once
      for (const u of [owner, watcher]) {
        const n = await notes(w.orgId, u.userId);
        expect(n, `user ${u.userId}`).toHaveLength(1);
        expect(n[0]).toMatchObject({
          type: 'form_submission',
          title: 'New form submission',
          link: `/forms/${form.id}/submissions?submission=${sub.uuid}`,
          dedupe_key: `form_submission:${sub.uuid}`,
        });
        expect(n[0]!.body).toBe(`Ada Lovelace submitted ${form.name}`);
        expect(n[0]!.data).toMatchObject({
          formId: form.id,
          submissionId: sub.uuid,
          created: true,
        });
      }
      expect(await notes(w.orgId, bystander.userId)).toEqual([]);
      const sent = mailbox().filter((m) => m.text.includes(sub.uuid));
      expect(sent.map((m) => m.to).sort()).toEqual(['boss@example.com', 'ops@example.com']);
      expect(sent[0]!.subject).toBe(`[Test CRM] New form submission: ${form.name}`);
      expect(sent[0]!.text).toContain(
        `http://localhost:3001/forms/${form.id}/submissions?submission=${sub.uuid}`,
      );
      expect(sent[0]!.text).toContain('Ada Lovelace just submitted');
      expect(sent[0]!.text).not.toMatch(/secret request|<b>|@example\.test/);
    });

    it('a returning contact is told as such; a held submission notifies once, and a full plan once a day, not once per lead', async () => {
      const w = await api.workspace('ntf2');
      const boss = await api.member(w, 'boss', [['record.contacts.read']]);
      const form = await api.liveForm(w.admin, {
        settings: {
          notify: { owner: false, userIds: [await api.userUuid(boss.userId)], emails: [] },
          rateLimits: { perContactPerHour: 100 },
        },
      });
      const email = fresh('rt');
      await api.submit(form.publicKey, { answers: { name: 'Rita', email } });
      await api.submit(form.publicKey, {
        idempotencyKey: 'rita-again-001',
        answers: { name: 'Rita', email },
      });
      await api.enable(w.orgId, { form_submissions_monthly: 2 });
      await api.submit(form.publicKey, { answers: { name: 'Over One', email: fresh('o1') } });
      await api.submit(form.publicKey, { answers: { name: 'Over Two', email: fresh('o2') } });
      await deliver(w.orgId);
      const n = await notes(w.orgId, boss.userId);
      expect(n.map((x) => x.type)).toEqual([
        'form_submission',
        'form_submission',
        'form_needs_review',
      ]);
      expect(n[1]).toMatchObject({ title: 'A contact submitted a form again' });
      expect(n[2]).toMatchObject({ title: 'A form submission needs review' });
      expect(n[2]!.body).toContain('monthly submission limit');
      expect(n[2]!.dedupe_key).toMatch(/^form_cap:/);
    });
  });
});
