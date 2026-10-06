import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthSettingsService } from '../../../src/modules/auth/platform/auth-settings.service';
import {
  FormsApi,
  contactDefinition,
  field,
  nextIp,
  startHarness,
  type CreatedForm,
  type Harness,
  type Tenant,
} from './support';

/**
 * The public side of Forms against a real Postgres, Redis and the real app (docs/specs/forms-builder-app.md 7.2, 7.3, 9 and 14): the
 * published definition, the origin rules and CORS, and the submission pipeline end to end: contact, company, tags, owner, attribution,
 * consent, timeline, audit and outbox in one transaction; dedupe and fill-blanks; idempotency; honeypot; rate limits; spam; the plan cap;
 * the contact quota; CAPTCHA; failure and recovery. Test names carry the rule they cover.
 */
let h: Harness;
let api: FormsApi;
let t: Tenant;
let userOne: { token: string; userId: number; uuid: string };
let userTwo: { token: string; userId: number; uuid: string };

const ADA = {
  name: 'Ada Lovelace',
  email: 'ada@acme.com',
  phone: '98765 43210',
  company: 'Acme Ltd',
  website: 'https://www.acme.com/about',
};
let seq = 0;
/** An address nobody used before in this run: the per-contact hourly budget is not what most tests are about. */
const fresh = (label = 'p') => `${label}${Date.now().toString(36)}${seq++}@example.test`;

beforeAll(async () => {
  h = await startHarness();
  api = new FormsApi(h);
  t = await api.workspace('pub');
  const a = await api.member(t, 'rr-one', [['record.contacts.read']]);
  const b = await api.member(t, 'rr-two', [['record.contacts.read']]);
  userOne = { ...a, uuid: await api.userUuid(a.userId) };
  userTwo = { ...b, uuid: await api.userUuid(b.userId) };
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const live = (body: Record<string, unknown> = {}, workspace: Tenant = t) =>
  api.liveForm(workspace.admin, body);

describe('the published definition (GET /v2/public/forms/:key)', () => {
  it('returns what the page needs and nothing about how the workspace works', async () => {
    const form = await live({
      definition: contactDefinition({
        description: '<p>Hello <script>alert(1)</script><b>there</b></p>',
        consent: {
          enabled: true,
          text: 'I agree',
          required: true,
          marketing: true,
          privacyUrl: 'https://example.com/privacy',
        },
      }),
      settings: {
        ownerRule: { mode: 'fixed', userIds: [userOne.uuid] },
        notify: { owner: true, userIds: [userTwo.uuid], emails: ['secret-boss@example.com'] },
      },
    });
    const res = await api.publicGet(form.publicKey);
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body).toMatchObject({
      key: form.publicKey,
      closed: false,
      version: 1,
      title: 'Get in touch',
      honeypotField: 'website_url',
      captcha: { required: false, version: null, siteKey: null },
      poweredBy: { show: true, label: 'Test CRM' },
      frameAncestors: { hosted: "'none'", embed: "'none'" },
      settings: { submitLabel: 'Submit', successMode: 'message', locale: 'en', dir: 'ltr' },
      consent: {
        enabled: true,
        text: 'I agree',
        required: true,
        version: 1,
        privacyUrl: 'https://example.com/privacy',
      },
      theme: { primary: '#2563eb', layout: 'classic' },
    });
    expect(body.description).toBe('<p>Hello <b>there</b></p>');
    expect(body.steps[0].blocks.map((b: { id: string }) => b.id)).toEqual([
      'name',
      'email',
      'phone',
      'company',
      'website',
      'note',
    ]);
    const text = JSON.stringify(body);
    for (const leak of [
      '"bind"',
      'ownerRule',
      'notify',
      'secret-boss',
      userOne.uuid,
      'allowedOrigins',
      'Website"',
      'retention',
      'rateLimits',
      'org_id',
      'orgId',
    ]) {
      expect(text, leak).not.toContain(leak);
    }
    expect(res.headers['cache-control']).toBe('public, max-age=30, s-maxage=30');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers.vary).toContain('Origin');
    expect(res.headers.etag).toMatch(/^W\/"/);
    const again = await api.publicGet(form.publicKey, {
      headers: { 'if-none-match': res.headers.etag as string },
    });
    expect(again.status).toBe(304);
    expect(again.text).toBe('');
  });

  it('an unknown, malformed, archived or plan-locked key is ONE 404 body', async () => {
    const live1 = await live();
    const locked = await api.workspace('lk');
    const lockedForm = await api.liveForm(locked.admin);
    await api.setOverrides(locked.orgId, { features: { form_builder: false } });
    await api
      .as(t.admin)
      .post(`/v2/forms/${live1.id}/archive`)
      .send({ rowVersion: live1.rowVersion });
    const bodies = [];
    for (const key of [
      'ZzZzZzZzZzZzZzZzZzZzZz',
      'short',
      'x'.repeat(22) + '!!',
      live1.publicKey,
      lockedForm.publicKey,
    ]) {
      const res = await api.publicGet(key);
      expect(res.status, key).toBe(404);
      bodies.push(JSON.stringify({ ...res.body, requestId: undefined, instance: undefined }));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toMatch(/plan|upgrade|archived/i);
  });

  it('the frame-ancestors the page must answer with come from the form: the hosted page is never frameable, an embed only by the allow-list', async () => {
    const form = await live({
      settings: { allowedOrigins: ['https://shop.example.com', 'https://*.partner.io'] },
    });
    const body = (await api.publicGet(form.publicKey)).body;
    expect(body.frameAncestors).toEqual({
      hosted: "'none'",
      embed: 'https://shop.example.com https://*.partner.io',
    });
  });

  it('a form with a CAPTCHA on and a configured provider says so, with the PUBLIC site key only', async () => {
    const form = await live({ settings: { captchaMode: 'on' } });
    const settings = h.app.get(AuthSettingsService);
    const spy = vi.spyOn(settings, 'captchaConfig').mockResolvedValue({
      version: 'v2',
      siteKey: 'site-key-1',
      secret: 'very-secret',
      threshold: 0.5,
    });
    try {
      const body = (await api.publicGet(form.publicKey)).body;
      expect(body.captcha).toEqual({ required: true, version: 'v2', siteKey: 'site-key-1' });
      expect(JSON.stringify(body)).not.toContain('very-secret');
      const off = await live({ settings: { captchaMode: 'off' } });
      expect((await api.publicGet(off.publicKey)).body.captcha.required).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('origins and CORS (spec 7.3)', () => {
  const evil = 'https://evil.example';

  it('an allowed origin is echoed (no credentials, Vary: Origin); a refused one gets 403 FORMS_ORIGIN_DENIED and no CORS headers; no Origin is not refused', async () => {
    const form = await live({
      settings: { allowedOrigins: ['https://shop.example.com', 'https://*.partner.io'] },
    });
    const ok = await api.publicGet(form.publicKey, { origin: 'https://shop.example.com' });
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('https://shop.example.com');
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
    expect(ok.headers.vary).toContain('Origin');
    expect(
      (await api.publicGet(form.publicKey, { origin: 'https://a.b.partner.io' })).headers[
        'access-control-allow-origin'
      ],
    ).toBe('https://a.b.partner.io');
    const denied = await api.publicGet(form.publicKey, { origin: evil });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORMS_ORIGIN_DENIED');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    expect((await api.publicGet(form.publicKey, { origin: 'https://partner.io' })).status).toBe(
      403,
    );
    expect((await api.publicGet(form.publicKey)).status).toBe(200);
  });

  it('an empty allow-list is the hosted page only: browsers on other origins are refused, our own web origin is not', async () => {
    const form = await live();
    expect((await api.publicGet(form.publicKey, { origin: evil })).status).toBe(403);
    const own = await api.publicGet(form.publicKey, { origin: 'http://localhost:3001' });
    expect(own.status).toBe(200);
    expect(own.headers['access-control-allow-origin']).toBe('http://localhost:3001');
  });

  it('a submit from a refused origin writes nothing; from an allowed one it works and answers CORS, even its errors', async () => {
    const form = await live({ settings: { allowedOrigins: ['https://shop.example.com'] } });
    const before = await api.contactCount(t.orgId);
    const email = fresh('cors');
    const denied = await api.submit(
      form.publicKey,
      { answers: { name: 'Eve', email } },
      { origin: evil },
    );
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORMS_ORIGIN_DENIED');
    expect(await api.contactCount(t.orgId)).toBe(before);
    expect(await api.submissions(t.orgId, form.id)).toHaveLength(0);
    const ok = await api.submit(
      form.publicKey,
      { answers: { name: 'Eve', email } },
      { origin: 'https://shop.example.com' },
    );
    expect(ok.status).toBe(201);
    expect(ok.headers['access-control-allow-origin']).toBe('https://shop.example.com');
    const invalid = await api.submit(
      form.publicKey,
      { answers: { name: 'Eve' } },
      { origin: 'https://shop.example.com' },
    );
    expect(invalid.status).toBe(422);
    expect(invalid.headers['access-control-allow-origin']).toBe('https://shop.example.com');
    // A server-to-server post has no Origin: an allow-list cannot stop a script, and does not try.
    expect(
      (await api.submit(form.publicKey, { answers: { name: 'Sam', email: fresh('s2s') } })).status,
    ).toBe(201);
  });

  it("the preflight is answered from the form's own allow-list: allowed origins get the headers, anyone else gets none, an unknown key looks the same", async () => {
    const form = await live({ settings: { allowedOrigins: ['https://shop.example.com'] } });
    const pre = (key: string, origin: string) =>
      api
        .http()
        .options(`/v2/public/forms/${key}/submit`)
        .set('origin', origin)
        .set('access-control-request-method', 'POST')
        .set('access-control-request-headers', 'content-type');
    const ok = await pre(form.publicKey, 'https://shop.example.com');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://shop.example.com');
    expect(ok.headers['access-control-allow-methods']).toContain('POST');
    expect(ok.headers['access-control-allow-headers']).toContain('Content-Type');
    const bad = await pre(form.publicKey, 'https://evil.example');
    expect(bad.status).toBe(204);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const unknown = await pre('ZzZzZzZzZzZzZzZzZzZzZz', 'https://shop.example.com');
    expect(unknown.status).toBe(204);
    expect(unknown.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('the submission pipeline (spec 9)', () => {
  it('one submission creates the contact, the company, the tag, the owner, the attribution, the consent, the timeline entry, the audit and the events, together', async () => {
    const w = await api.workspace('e2e');
    const rr = await api.member(w, 'rr', [['record.contacts.read']]);
    const rrUuid = await api.userUuid(rr.userId);
    await api.property(w.orgId, 'contacts', 'budget', 'integer');
    await api.property(w.orgId, 'contacts', 'interests', 'multiselect');
    const def = contactDefinition({
      consent: { enabled: true, text: 'I agree to be contacted', required: true, marketing: true },
      after: { tags: ['Website', 'Hot'] },
    });
    def.steps[0]!.blocks.push(
      field('budget', 'number', { bind: { object: 'contact', property: 'budget' } }),
      field('interests', 'checkbox_group', {
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        bind: { object: 'contact', property: 'interests' },
      }),
      field('src', 'hidden', { hiddenSource: 'utm_source' }),
    );
    const form = await api.liveForm(w.admin, {
      definition: def,
      settings: {
        ownerRule: { mode: 'fixed', userIds: [rrUuid] },
        notify: { owner: true, userIds: [], emails: [] },
      },
    });
    const ip = nextIp();
    const res = await api.submit(
      form.publicKey,
      {
        idempotencyKey: 'happy-path-0001',
        answers: {
          ...ADA,
          note: 'Interested in 20 licences',
          budget: '5000',
          interests: ['a', 'b'],
          src: 'FORGED',
        },
        hidden: {
          utm_source: 'google',
          utm_campaign: 'spring',
          referrer: 'https://ref.example/x',
          page_url: 'https://shop.example/pricing?x=1',
        },
        consent: { given: true, textVersion: 1 },
        elapsedMs: 12_000,
      },
      { ip, headers: { 'user-agent': 'TestBrowser/1.0' } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.submissionToken).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(res.body.next).toEqual({ type: 'message', message: '<p>Thanks, <b>we got it</b>.</p>' });
    // The sender learns nothing about the CRM.
    expect(JSON.stringify(res.body)).not.toMatch(
      /contact|company|created|updated|owner|spam|review/i,
    );

    const contact = await api.contactByEmail(w.orgId, 'ada@acme.com');
    expect(contact).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@acme.com',
      phone: '+919876543210',
      source: `Form: ${form.name}`,
      owner_id: rr.userId,
    });
    expect(contact!.data).toEqual({ budget: 5000, interests: ['a', 'b'] });
    expect(contact!.email_subscription_status).toBe('subscribed');
    expect(contact!.whatsapp_subscription_status).toBe('subscribed');

    const company = (await api.rows(w.orgId, `SELECT * FROM companies WHERE org_id = $1`))[0]!;
    expect(company).toMatchObject({ name: 'Acme Ltd', domain: 'acme.com', owner_id: rr.userId });
    expect(Number(contact!.company_id)).toBe(Number(company.id));

    const tags = await api.rows(
      w.orgId,
      `SELECT t.name FROM contact_tags ct JOIN tags t ON t.org_id = ct.org_id AND t.id = ct.tag_id WHERE ct.org_id = $1 AND ct.contact_id = $2 ORDER BY t.name`,
      [contact!.id],
    );
    expect(tags.map((x) => x.name)).toEqual(['Hot', 'Website']);

    const attr = await api.rows(
      w.orgId,
      `SELECT * FROM contact_attributions WHERE org_id = $1 AND contact_id = $2`,
      [contact!.id],
    );
    expect(attr).toHaveLength(1);
    expect(attr[0]).toMatchObject({
      platform: 'form',
      source_label: 'Form',
      campaign: 'spring',
      form: form.name,
      lead_event_id: null,
      source_id: null,
    });

    const timeline = await api.rows(
      w.orgId,
      `SELECT * FROM contact_activities WHERE org_id = $1 AND contact_id = $2`,
      [contact!.id],
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      activity_type: 'form_submission',
      title: `Submitted ${form.name}`,
      source: 'system',
    });
    expect(contact!.last_activity_at).toBeTruthy();

    const sub = (await api.submissions(w.orgId, form.id))[0]!;
    expect(sub).toMatchObject({
      status: 'created',
      reason: null,
      idempotency_key: 'happy-path-0001',
      referrer: 'https://ref.example/x',
      page_url: 'https://shop.example/pricing?x=1',
      user_agent: 'TestBrowser/1.0',
      spam_score: 0,
    });
    expect(Number(sub.contact_id)).toBe(Number(contact!.id));
    expect(Number(sub.company_id)).toBe(Number(company.id));
    expect(sub.receipt_token).toBe(res.body.submissionToken);
    expect(sub.answers).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@acme.com',
      phone: '+919876543210',
      budget: 5000,
      interests: ['a', 'b'],
      src: 'google',
    });
    expect(sub.answers.src).toBe('google');
    expect(sub.utm).toEqual({ utm_source: 'google', utm_campaign: 'spring' });
    expect(sub.consent).toMatchObject({
      given: true,
      text: 'I agree to be contacted',
      version: 1,
      shownVersion: 1,
    });
    expect(sub.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(sub)).not.toContain(ip);
    const days =
      (new Date(sub.answers_expires_at).getTime() - new Date(sub.created_at).getTime()) /
      86_400_000;
    expect(Math.round(days)).toBe(365);

    // Audit and outbox are in the same transaction as the writes.
    expect(await api.auditCount(w.orgId, 'web_form_submissions', 'insert')).toBe(1);
    expect(await api.auditCount(w.orgId, 'web_form_submissions', 'update')).toBe(1);
    expect(await api.auditCount(w.orgId, 'contacts', 'insert')).toBe(1);
    expect(await api.auditCount(w.orgId, 'companies', 'insert')).toBe(1);
    const submitted = await api.eventsOfType(w.orgId, 'form.submitted');
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.payload).toMatchObject({
      formId: form.id,
      formName: form.name,
      submissionId: sub.uuid,
      created: true,
      status: 'created',
      contactName: 'Ada Lovelace',
      ownerId: rrUuid,
      notify: [rrUuid],
    });
    expect(JSON.stringify(submitted[0]!.payload)).not.toContain('ada@acme.com');
    const created = await api.eventsOfType(w.orgId, 'contact.created');
    expect(created).toHaveLength(1);
    expect(created[0]!.payload).toMatchObject({
      origin: 'form',
      formId: form.id,
      submissionId: sub.uuid,
    });
    expect((await api.eventsOfType(w.orgId, 'company.created'))[0]!.payload).toMatchObject({
      name: 'Acme Ltd',
      via: 'form',
    });
    const optIn = await api.eventsOfType(w.orgId, 'contact.opt_in');
    expect(optIn).toHaveLength(1);
    expect(optIn[0]!.payload).toMatchObject({
      optedIn: true,
      action: 'subscribed',
      source: 'form',
      formId: form.id,
    });
  });

  it('the same idempotency key is the same submission: the stored answer comes back and nothing is written twice', async () => {
    const form = await live();
    const email = fresh('idem');
    const body = { idempotencyKey: 'repeat-key-0001', answers: { name: 'Ida', email } };
    const first = await api.submit(form.publicKey, body);
    const contactsAfterFirst = await api.contactCount(t.orgId);
    const second = await api.submit(form.publicKey, body);
    const third = await api.submit(form.publicKey, {
      ...body,
      answers: { name: 'Different', email },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(third.body.submissionToken).toBe(first.body.submissionToken);
    expect(await api.contactCount(t.orgId)).toBe(contactsAfterFirst);
    expect(await api.submissions(t.orgId, form.id)).toHaveLength(1);
    expect(
      await api.rows(t.orgId, `SELECT 1 FROM contact_activities WHERE org_id = $1 AND title = $2`, [
        `Submitted ${form.name}`,
      ]),
    ).toHaveLength(1);
    // Two simultaneous posts of one key are one submission too.
    const key = 'race-key-00001';
    const em = fresh('race');
    const [r1, r2] = await Promise.all([
      api.submit(form.publicKey, { idempotencyKey: key, answers: { name: 'Rae', email: em } }),
      api.submit(form.publicKey, { idempotencyKey: key, answers: { name: 'Rae', email: em } }),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r1.body.submissionToken).toBe(r2.body.submissionToken);
    expect(
      (await api.submissions(t.orgId, form.id)).filter((s) => s.idempotency_key === key),
    ).toHaveLength(1);
  });

  it('a returning contact is found by email, then phone: one contact, status updated, blanks filled and nothing curated overwritten, owner kept', async () => {
    const w = await api.workspace('dd');
    const owner = await api.member(w, 'owner-x', [['record.contacts.read']]);
    const taker = await api.member(w, 'taker-x', [['record.contacts.read']]);
    await api.property(w.orgId, 'contacts', 'budget', 'integer');
    await api.property(w.orgId, 'contacts', 'tier', 'text');
    const def = contactDefinition();
    def.steps[0]!.blocks.push(
      field('budget', 'number', { bind: { object: 'contact', property: 'budget' } }),
      field('tier', 'short_text', { bind: { object: 'contact', property: 'tier' } }),
      field('title', 'short_text', { bind: { object: 'contact', property: 'title' } }),
    );
    const form = await api.liveForm(w.admin, {
      definition: def,
      settings: {
        ownerRule: { mode: 'fixed', userIds: [await api.userUuid(taker.userId)] },
        rateLimits: { perContactPerHour: 50 },
      },
    });
    await api.contact(w.admin, {
      name: 'Curated Name',
      email: 'dee@acme.com',
      ownerId: await api.userUuid(owner.userId),
      customFields: { tier: 'gold' },
    });
    const res = await api.submit(form.publicKey, {
      answers: {
        name: 'Form Name',
        email: 'DEE@acme.com',
        phone: '98765 11111',
        budget: 900,
        tier: 'silver',
        title: 'CTO',
      },
    });
    expect(res.status).toBe(201);
    expect(await api.contactCount(w.orgId)).toBe(1);
    const c = (await api.contactByEmail(w.orgId, 'dee@acme.com'))!;
    expect(c.name).toBe('Curated Name');
    expect(c.owner_id).toBe(owner.userId);
    expect(c.phone).toBe('+919876511111');
    expect(c.data).toEqual({ tier: 'gold', budget: 900 });
    expect(
      (
        await api.rows(w.orgId, `SELECT title FROM contacts WHERE org_id = $1 AND id = $2`, [c.id])
      )[0]!.title,
    ).toBe('CTO');
    const sub = (await api.submissions(w.orgId, form.id))[0]!;
    expect(sub.status).toBe('updated');
    expect((await api.eventsOfType(w.orgId, 'form.submitted'))[0]!.payload).toMatchObject({
      created: false,
      status: 'updated',
      ownerId: await api.userUuid(owner.userId),
    });
    // The only `contact.created` is the one for the contact made by hand above: the submission made none.
    expect(await api.eventsOfType(w.orgId, 'contact.created')).toHaveLength(1);
    expect((await api.eventsOfType(w.orgId, 'contact.updated'))[0]!.payload).toMatchObject({
      via: 'form',
    });
    // Found again by the phone alone (the email is new to this contact: the identity is added, the existing email column kept).
    const byPhone = await api.submit(form.publicKey, {
      answers: { name: 'Again', email: 'dee.work@acme.com', phone: '+91 98765 11111' },
    });
    expect(byPhone.status).toBe(201);
    expect(await api.contactCount(w.orgId)).toBe(1);
    expect((await api.contactByEmail(w.orgId, 'dee@acme.com'))!.email).toBe('dee@acme.com');
    const identities = await api.rows(
      w.orgId,
      `SELECT kind, value FROM contact_identities WHERE org_id = $1 AND contact_id = $2 ORDER BY kind, value`,
      [c.id],
    );
    expect(identities.map((i) => `${i.kind}:${i.value}`).sort()).toEqual([
      'email:dee.work@acme.com',
      'email:dee@acme.com',
      'phone:+919876511111',
    ]);
  });

  it('a phone that belongs to ANOTHER contact is not stolen; the submission still lands on the contact the email found', async () => {
    const w = await api.workspace('stl');
    const form = await api.liveForm(w.admin, {
      settings: { rateLimits: { perContactPerHour: 50 } },
    });
    await api.contact(w.admin, { name: 'Holder', phone: '+919800000001', email: 'holder@x.test' });
    await api.contact(w.admin, { name: 'Emailer', email: 'emailer@x.test' });
    const res = await api.submit(form.publicKey, {
      answers: { name: 'X', email: 'emailer@x.test', phone: '+919800000001' },
    });
    expect(res.status).toBe(201);
    expect(await api.contactCount(w.orgId)).toBe(2);
    const emailer = (await api.contactByEmail(w.orgId, 'emailer@x.test'))!;
    expect(emailer.phone).toBeNull();
    const holder = (await api.contactByEmail(w.orgId, 'holder@x.test'))!;
    expect(holder.phone).toBe('+919800000001');
  });

  it('company: found by website then by name and linked, filled but never overwritten; a contact already in a company is not moved; free mail implies nothing', async () => {
    const w = await api.workspace('cmp');
    const form = await api.liveForm(w.admin, {
      settings: { rateLimits: { perContactPerHour: 50 } },
    });
    const first = await api.submit(form.publicKey, {
      answers: { name: 'A', email: fresh('a'), company: 'Acme Ltd', website: 'acme.com' },
    });
    expect(first.status).toBe(201);
    await h.owner.query(`UPDATE companies SET industry = 'Curated industry' WHERE org_id = $1`, [
      w.orgId,
    ]);
    // Same website spelled differently, another name: the SAME company; blanks filled, industry untouched.
    await api.submit(form.publicKey, {
      answers: {
        name: 'B',
        email: fresh('b'),
        company: 'ACME LIMITED',
        website: 'https://WWW.Acme.com/',
      },
    });
    expect(await api.companyCount(w.orgId)).toBe(1);
    // Same name, no website: found by name (case-insensitive).
    await api.submit(form.publicKey, {
      answers: { name: 'C', email: fresh('c'), company: 'acme ltd' },
    });
    expect(await api.companyCount(w.orgId)).toBe(1);
    // A different company is made, once.
    await api.submit(form.publicKey, {
      answers: { name: 'D', email: fresh('d'), company: 'Other Co', website: 'other.io' },
    });
    expect(await api.companyCount(w.orgId)).toBe(2);
    const acme = (
      await api.rows(w.orgId, `SELECT * FROM companies WHERE org_id = $1 AND name = 'Acme Ltd'`)
    )[0]!;
    expect(acme.domain).toBe('acme.com');
    expect(acme.industry).toBe('Curated industry');
    const linked = await api.rows(
      w.orgId,
      `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND company_id = $2`,
      [acme.id],
    );
    expect(linked[0]!.n).toBe(3);
    // A contact that already has a company keeps it.
    await api.contact(w.admin, { name: 'Mover', email: 'mover@x.test' });
    await h.owner.query(
      `UPDATE contacts SET company_id = $2 WHERE org_id = $1 AND normalized_email = 'mover@x.test'`,
      [w.orgId, acme.id],
    );
    await api.submit(form.publicKey, {
      answers: {
        name: 'Mover',
        email: 'mover@x.test',
        company: 'Brand New Inc',
        website: 'brandnew.io',
      },
    });
    expect(await api.companyCount(w.orgId)).toBe(2);
    expect(Number((await api.contactByEmail(w.orgId, 'mover@x.test'))!.company_id)).toBe(
      Number(acme.id),
    );
  });

  it('match by email domain: a business address finds or makes the company of its domain; a free mail address makes none; `none` never touches companies', async () => {
    const w = await api.workspace('dom');
    const def = (match: string) => ({
      title: 'T',
      steps: [
        {
          id: 'main',
          blocks: [
            field('name', 'short_text', { bind: { object: 'contact', property: 'name' } }),
            field('email', 'email', {
              required: true,
              bind: { object: 'contact', property: 'email' },
            }),
          ],
        },
      ],
      mapping: { company: { match } },
    });
    const byDomain = await api.liveForm(w.admin, { definition: def('email_domain') });
    await api.submit(byDomain.publicKey, { answers: { name: 'Biz', email: 'biz@initech.com' } });
    await api.submit(byDomain.publicKey, {
      answers: { name: 'Biz Two', email: 'two@Initech.com' },
    });
    await api.submit(byDomain.publicKey, { answers: { name: 'Home', email: 'home@gmail.com' } });
    expect(await api.companyCount(w.orgId)).toBe(1);
    const co = (await api.rows(w.orgId, `SELECT * FROM companies WHERE org_id = $1`))[0]!;
    expect(co).toMatchObject({ name: 'Initech', domain: 'initech.com' });
    expect(
      (
        await api.rows(
          w.orgId,
          `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND company_id = $2`,
          [co.id],
        )
      )[0]!.n,
    ).toBe(2);
    expect((await api.contactByEmail(w.orgId, 'home@gmail.com'))!.company_id).toBeNull();
    const none = await api.liveForm(w.admin, { definition: def('none') });
    await api.submit(none.publicKey, { answers: { name: 'N', email: 'n@umbrella.com' } });
    expect(await api.companyCount(w.orgId)).toBe(1);
  });

  it('owner: round robin takes turns across the listed active users, a user who left drops out, an owner already on the contact costs no turn', async () => {
    const form = await live({
      settings: {
        ownerRule: { mode: 'round_robin', userIds: [userOne.uuid, userTwo.uuid] },
        rateLimits: { perContactPerHour: 50 },
      },
    });
    const owners: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const email = fresh('rr');
      expect(
        (await api.submit(form.publicKey, { answers: { name: `RR ${i}`, email } })).status,
      ).toBe(201);
      owners.push(Number((await api.contactByEmail(t.orgId, email))!.owner_id));
    }
    expect(owners).toEqual([userOne.userId, userTwo.userId, userOne.userId, userTwo.userId]);
    // A returning contact keeps their owner and spends no turn.
    await api.contact(t.admin, {
      name: 'Has owner',
      email: 'hasowner@x.test',
      ownerId: userTwo.uuid,
    });
    await api.submit(form.publicKey, { answers: { name: 'Has owner', email: 'hasowner@x.test' } });
    expect((await api.contactByEmail(t.orgId, 'hasowner@x.test'))!.owner_id).toBe(userTwo.userId);
    const next = fresh('rr');
    await api.submit(form.publicKey, { answers: { name: 'Next', email: next } });
    expect((await api.contactByEmail(t.orgId, next))!.owner_id).toBe(userOne.userId);
    // The cursor moves without touching the editor's row version.
    const detail = (await api.as(t.admin).get(`/v2/forms/${form.id}`)).body;
    expect(detail.rowVersion).toBe(form.rowVersion);
    // A user who is deactivated drops out of the rotation.
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [userOne.userId]);
    const after = fresh('rr');
    await api.submit(form.publicKey, { answers: { name: 'After', email: after } });
    expect((await api.contactByEmail(t.orgId, after))!.owner_id).toBe(userTwo.userId);
    await h.owner.query(`UPDATE users SET status = 'active' WHERE id = $1`, [userOne.userId]);
  });

  it('consent: an unticked box never subscribes; a ticked marketing box does, once; a contact who unsubscribed stays unsubscribed; a required box not ticked is refused', async () => {
    const form = await live({
      definition: contactDefinition({
        consent: { enabled: true, text: 'Subscribe me', required: false, marketing: true },
      }),
      settings: { rateLimits: { perContactPerHour: 50 } },
    });
    const a = fresh('c1');
    await api.submit(form.publicKey, {
      answers: { name: 'No Tick', email: a },
      consent: { given: false, textVersion: 1 },
    });
    expect((await api.contactByEmail(t.orgId, a))!.email_subscription_status).toBeNull();
    expect((await api.submissions(t.orgId, form.id)).at(-1)!.consent).toMatchObject({
      given: false,
    });
    const b = fresh('c2');
    await api.submit(form.publicKey, {
      answers: { name: 'Tick', email: b },
      consent: { given: true, textVersion: 1 },
    });
    expect((await api.contactByEmail(t.orgId, b))!.email_subscription_status).toBe('subscribed');
    const optIns = (await api.eventsOfType(t.orgId, 'contact.opt_in')).length;
    await api.submit(form.publicKey, {
      answers: { name: 'Tick', email: b },
      consent: { given: true, textVersion: 1 },
    });
    expect((await api.eventsOfType(t.orgId, 'contact.opt_in')).length).toBe(optIns);
    const c = fresh('c3');
    await api.contact(t.admin, { name: 'Out', email: c, isUnsubscribed: true });
    await api.submit(form.publicKey, {
      answers: { name: 'Out', email: c },
      consent: { given: true, textVersion: 1 },
    });
    expect((await api.contactByEmail(t.orgId, c))!.email_subscription_status).toBeNull();
    const required = await live({
      definition: contactDefinition({
        consent: { enabled: true, text: 'Must tick', required: true },
      }),
    });
    const refused = await api.submit(required.publicKey, {
      answers: { name: 'N', email: fresh('c4') },
      consent: { given: false, textVersion: 1 },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.errors).toContainEqual({ path: 'consent', message: 'required' });
  });

  it('validation: 422 FORMS_VALIDATION lists every field with its rule (the one case the sender learns specifics); nothing is stored', async () => {
    const form = await live();
    const before = await api.contactCount(t.orgId);
    const res = await api.submit(form.publicKey, {
      answers: { name: '', email: 'not-an-email', phone: 'call me' },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('FORMS_VALIDATION');
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        { path: 'name', message: 'required' },
        { path: 'email', message: 'invalid_email' },
        { path: 'phone', message: 'invalid_phone' },
      ]),
    );
    expect(await api.contactCount(t.orgId)).toBe(before);
    expect(await api.submissions(t.orgId, form.id)).toHaveLength(0);
    // The shape of the body is checked at the edge too.
    expect((await api.submit(form.publicKey, { idempotencyKey: 'x' })).status).toBe(422);
    expect(
      (await api.submit(form.publicKey, { answers: { name: 'a'.repeat(4000), email: fresh('v') } }))
        .status,
    ).toBe(422);
  });

  it('only JSON is accepted', async () => {
    const form = await live();
    const res = await api
      .http()
      .post(`/v2/public/forms/${form.publicKey}/submit`)
      .set('x-forwarded-for', nextIp())
      .type('form')
      .send({ idempotencyKey: 'form-body-001', name: 'A' });
    expect(res.status).toBe(415);
  });

  it('a field id the form does not have is dropped; a visitor can never set the owner, lifecycle stage or tags', async () => {
    const form = await live({
      settings: { ownerRule: { mode: 'fixed', userIds: [userOne.uuid] } },
    });
    const email = fresh('hack');
    const res = await api.submit(form.publicKey, {
      answers: {
        name: 'Hacker',
        email,
        owner: userTwo.uuid,
        ownerId: userTwo.userId,
        lifecycle_stage: 'won',
        tags: ['Admin'],
        owner_id: 1,
      },
    });
    expect(res.status).toBe(201);
    const c = (await api.contactByEmail(t.orgId, email))!;
    expect(c.owner_id).toBe(userOne.userId);
    expect(c.lifecycle_stage).not.toBe('won');
    const tags = await api.rows(
      t.orgId,
      `SELECT t.name FROM contact_tags ct JOIN tags t ON t.org_id = ct.org_id AND t.id = ct.tag_id WHERE ct.org_id = $1 AND ct.contact_id = $2`,
      [c.id],
    );
    expect(tags.map((x) => x.name)).toEqual(['Website']);
    const sub = (await api.submissions(t.orgId, form.id)).at(-1)!;
    expect(Object.keys(sub.answers).sort()).toEqual(['email', 'name']);
  });

  it("the thank-you is the form's own: a message sanitised on the way out, or an https redirect", async () => {
    const redirect = await live({
      definition: contactDefinition({
        settings: { successMode: 'redirect', redirectUrl: 'https://example.com/thanks' },
      }),
    });
    const res = await api.submit(redirect.publicKey, {
      answers: { name: 'R', email: fresh('red') },
    });
    expect(res.body.next).toEqual({ type: 'redirect', url: 'https://example.com/thanks' });
  });
});

describe('edge controls (spec 9.1 and 14)', () => {
  it('a filled honeypot is a silent success: nothing is stored, no contact, only a counter', async () => {
    const form = await live();
    const before = await api.contactCount(t.orgId);
    const email = fresh('bot');
    const res = await api.submit(form.publicKey, {
      answers: { name: 'Bot', email },
      hp: 'http://spam.example',
    });
    expect(res.status).toBe(201);
    expect(res.body.next.type).toBe('message');
    expect(res.body.submissionToken).toMatch(/^[A-Za-z0-9]{22}$/);
    expect(await api.contactCount(t.orgId)).toBe(before);
    expect(await api.submissions(t.orgId, form.id)).toHaveLength(0);
    const usage = await api.rows(
      t.orgId,
      `SELECT spam_blocked FROM web_form_usage_monthly WHERE org_id = $1`,
    );
    expect(usage[0]!.spam_blocked).toBeGreaterThanOrEqual(1);
    // With the honeypot turned off for the form, the field is just ignored.
    const off = await live({ settings: { honeypot: false } });
    expect(
      (await api.submit(off.publicKey, { answers: { name: 'Odd', email: fresh('hp') }, hp: 'x' }))
        .status,
    ).toBe(201);
    expect(await api.submissions(t.orgId, off.id)).toHaveLength(1);
  });

  it('rate limits: per address and per form per minute, per contact per hour: 429 RATE_LIMITED with retryAfterSeconds; nothing is written over the limit', async () => {
    const form = await live({
      settings: { rateLimits: { perIpPerMinute: 2, perFormPerMinute: 4, perContactPerHour: 1 } },
    });
    const ip = '10.99.1.1';
    expect(
      (await api.submit(form.publicKey, { answers: { name: 'A', email: fresh('rl') } }, { ip }))
        .status,
    ).toBe(201);
    expect(
      (await api.submit(form.publicKey, { answers: { name: 'A', email: fresh('rl') } }, { ip }))
        .status,
    ).toBe(201);
    const third = await api.submit(
      form.publicKey,
      { answers: { name: 'A', email: fresh('rl') } },
      { ip },
    );
    expect(third.status).toBe(429);
    expect(third.body.code).toBe('RATE_LIMITED');
    expect(third.body.errors).toContainEqual({
      path: 'retryAfterSeconds',
      message: expect.stringMatching(/^\d+$/),
    });
    expect(await api.submissions(t.orgId, form.id)).toHaveLength(2);
    // Another address, same form: the form budget (4 a minute, refused attempts counted) is shared.
    expect(
      (await api.submit(form.publicKey, { answers: { name: 'B', email: fresh('rl') } })).status,
    ).toBe(201);
    const byForm = await api.submit(form.publicKey, { answers: { name: 'B', email: fresh('rl') } });
    expect(byForm.status).toBe(429);
    expect(byForm.body.code).toBe('RATE_LIMITED');
    // The same contact point: one an hour.
    const f2 = await live({ settings: { rateLimits: { perContactPerHour: 1 } } });
    const same = fresh('same');
    expect((await api.submit(f2.publicKey, { answers: { name: 'S', email: same } })).status).toBe(
      201,
    );
    expect(
      (
        await api.submit(f2.publicKey, {
          idempotencyKey: 'second-key-0001',
          answers: { name: 'S', email: same.toUpperCase() },
        })
      ).status,
    ).toBe(429);
  });

  it('the per-address budget before any lookup: a scan of random keys is throttled without touching the database', async () => {
    const ip = '10.99.2.2';
    let status = 0;
    for (let i = 0; i < 125; i += 1)
      status = (await api.publicGet('ZzZzZzZzZzZzZzZzZzZzZz', { ip })).status;
    expect(status).toBe(429);
  });

  it('spam: links and stock phrases are stored as spam (no CRM write) and the sender still sees a normal success; "not spam" runs it', async () => {
    const w = await api.workspace('spm');
    const form = await api.liveForm(w.admin);
    const email = fresh('spam');
    const res = await api.submit(form.publicKey, {
      answers: {
        name: 'Seo Guy',
        email,
        note: 'We offer cheap SEO services and backlinks, visit https://spam.example and http://other.example today',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.next.type).toBe('message');
    expect(await api.contactCount(w.orgId)).toBe(0);
    const sub = (await api.submissions(w.orgId, form.id))[0]!;
    expect(sub).toMatchObject({ status: 'spam', reason: 'spam_score' });
    expect(sub.spam_score).toBeGreaterThanOrEqual(100);
    expect(sub.contact_id).toBeNull();
    // Spam is not counted as an accepted submission.
    const list = await api.as(w.admin).get(`/v2/forms/${form.id}/submissions`);
    expect(list.body.data).toEqual([]);
    expect(
      (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions?tab=spam`)).body.data,
    ).toHaveLength(1);
    const retried = await api
      .as(w.admin)
      .post(`/v2/forms/${form.id}/submissions/${sub.uuid}/retry`)
      .send({});
    expect(retried.status).toBe(200);
    expect(retried.body.status).toBe('created');
    expect(await api.contactCount(w.orgId)).toBe(1);
  });

  it('a very fast submit is scored, not refused on its own', async () => {
    const form = await live();
    const res = await api.submit(form.publicKey, {
      answers: { name: 'Fast', email: fresh('fast') },
      elapsedMs: 300,
    });
    expect(res.status).toBe(201);
    const sub = (await api.submissions(t.orgId, form.id))[0]!;
    expect(sub).toMatchObject({ status: 'created', spam_score: 50 });
  });

  it('CAPTCHA: when the form asks and a provider is configured, a missing or wrong token is refused before anything is written; a good one passes; `off` skips it', async () => {
    const form = await live({ settings: { captchaMode: 'inherit' } });
    const off = await live({ settings: { captchaMode: 'off' } });
    const settings = h.app.get(AuthSettingsService);
    const spy = vi
      .spyOn(settings, 'captchaConfig')
      .mockResolvedValue({ version: 'v2', siteKey: 's', secret: 'x', threshold: 0.5 });
    try {
      const before = await api.contactCount(t.orgId);
      const missing = await api.submit(form.publicKey, {
        answers: { name: 'C', email: fresh('cap') },
      });
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('AUTH_CAPTCHA_FAILED');
      const bad = await api.submit(form.publicKey, {
        answers: { name: 'C', email: fresh('cap') },
        captchaToken: 'bad',
      });
      expect(bad.body.code).toBe('AUTH_CAPTCHA_FAILED');
      expect(await api.contactCount(t.orgId)).toBe(before);
      const good = await api.submit(form.publicKey, {
        answers: { name: 'C', email: fresh('cap') },
        captchaToken: h.captchaValid.token,
      });
      expect(good.status).toBe(201);
      expect(
        (await api.submit(off.publicKey, { answers: { name: 'C', email: fresh('cap') } })).status,
      ).toBe(201);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('what cannot become a contact is kept, never dropped (spec 9.7)', () => {
  it('no usable email or phone: stored needs_review no_contact_point with its answers; the sender sees success; a notification event is announced', async () => {
    const w = await api.workspace('nocp');
    const def = {
      title: 'T',
      steps: [
        {
          id: 'main',
          blocks: [
            field('name', 'short_text', { bind: { object: 'contact', property: 'name' } }),
            field('email', 'email', { bind: { object: 'contact', property: 'email' } }),
            field('phone', 'phone', { bind: { object: 'contact', property: 'phone' } }),
          ],
        },
      ],
      settings: { phoneCountryCode: '91' },
    };
    const form = await api.liveForm(w.admin, { definition: def });
    const res = await api.submit(form.publicKey, { answers: { name: 'Nobody' } });
    expect(res.status).toBe(201);
    expect(await api.contactCount(w.orgId)).toBe(0);
    const sub = (await api.submissions(w.orgId, form.id))[0]!;
    expect(sub).toMatchObject({ status: 'needs_review', reason: 'no_contact_point' });
    expect(sub.answers).toEqual({ name: 'Nobody' });
    expect(sub.error).toContain('neither a usable email');
    expect((await api.eventsOfType(w.orgId, 'form.needs_review'))[0]!.payload).toMatchObject({
      reason: 'no_contact_point',
      submissionId: sub.uuid,
    });
    expect(await api.eventsOfType(w.orgId, 'form.submitted')).toHaveLength(0);
    const list = (await api.as(w.admin).get(`/v2/forms/${form.id}/submissions?tab=needs_attention`))
      .body.data;
    expect(list).toHaveLength(1);
    expect((await api.as(w.admin).get('/v2/forms')).body.data[0].needsReview).toBe(1);
    // Retrying changes nothing while the answers have no contact point: it stays in review.
    const retried = await api
      .as(w.admin)
      .post(`/v2/forms/${form.id}/submissions/${sub.uuid}/retry`)
      .send({});
    expect(retried.body.status).toBe('needs_review');
  });

  it('contact quota reached: a NEW contact is held as needs_review plan_limit_reached, an existing one still updates; after the limit is lifted a retry creates it', async () => {
    const w = await api.workspace('quota', { contacts: 1 });
    const form = await api.liveForm(w.admin, {
      settings: { rateLimits: { perContactPerHour: 50 } },
    });
    await api.contact(w.admin, { name: 'Existing', email: 'existing@x.test' });
    const newcomer = fresh('quota');
    expect(
      (await api.submit(form.publicKey, { answers: { name: 'New One', email: newcomer } })).status,
    ).toBe(201);
    expect(await api.contactCount(w.orgId)).toBe(1);
    const held = (await api.submissions(w.orgId, form.id))[0]!;
    expect(held).toMatchObject({ status: 'needs_review', reason: 'plan_limit_reached' });
    expect(held.answers.email).toBe(newcomer);
    expect(
      (
        await api.submit(form.publicKey, {
          answers: { name: 'Existing Again', email: 'existing@x.test', phone: '98765 22222' },
        })
      ).status,
    ).toBe(201);
    expect((await api.contactByEmail(w.orgId, 'existing@x.test'))!.phone).toBe('+919876522222');
    await api.enable(w.orgId, { contacts: 5 });
    const retried = await api
      .as(w.admin)
      .post(`/v2/forms/${form.id}/submissions/${held.uuid}/retry`)
      .send({});
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ status: 'created', contact: { name: 'New One' } });
    expect(await api.contactCount(w.orgId)).toBe(2);
    expect(await api.eventsOfType(w.orgId, 'form.submitted')).toHaveLength(2);
  });

  it("the plan's monthly submission cap: over it a submission is stored needs_review submissions_cap, the visitor still sees success, and no lead is dropped", async () => {
    const w = await api.workspace('mcap', { form_submissions_monthly: 2 });
    const form = await api.liveForm(w.admin, {
      settings: { rateLimits: { perContactPerHour: 50 } },
    });
    for (let i = 0; i < 2; i += 1)
      expect(
        (await api.submit(form.publicKey, { answers: { name: `In ${i}`, email: fresh('mc') } }))
          .status,
      ).toBe(201);
    const over = fresh('mc');
    const res = await api.submit(form.publicKey, { answers: { name: 'Over', email: over } });
    expect(res.status).toBe(201);
    expect(res.body.next.type).toBe('message');
    expect(await api.contactCount(w.orgId)).toBe(2);
    const rows = await api.submissions(w.orgId, form.id);
    expect(rows.map((r) => r.status)).toEqual(['created', 'created', 'needs_review']);
    expect(rows[2]).toMatchObject({ reason: 'submissions_cap' });
    expect(rows[2]!.answers.email).toBe(over);
    // Spam does not eat the cap.
    await api.setOverrides(w.orgId, {
      features: { form_builder: true },
      limits: { form_submissions_monthly: 3 },
    });
    expect(
      (await api.submit(form.publicKey, { answers: { name: 'In 3', email: fresh('mc') } })).status,
    ).toBe(201);
    expect((await api.submissions(w.orgId, form.id)).at(-1)!.status).toBe('created');
  });

  it('an unexpected error rolls the whole submission back, is recorded failed on its own, the sender gets a generic 500, and a retry with the SAME key recovers', async () => {
    const w = await api.workspace('fail');
    const owner = await api.member(w, 'rr', [['record.contacts.read']]);
    const form = await api.liveForm(w.admin, {
      settings: {
        ownerRule: { mode: 'fixed', userIds: [await api.userUuid(owner.userId)] },
        rateLimits: { perContactPerHour: 50 },
      },
    });
    // A bad owner rule makes the owner lookup throw inside the transaction (arranged with the owner connection: the API refuses it).
    await h.owner.query(
      `UPDATE web_forms SET owner_rule = '{"mode":"fixed","userIds":["not-a-uuid"]}'::jsonb WHERE uuid = $1::uuid`,
      [form.id],
    );
    const email = fresh('fail');
    const body = { idempotencyKey: 'recover-key-001', answers: { name: 'Frank', email } };
    const failed = await api.submit(form.publicKey, body);
    expect(failed.status).toBe(500);
    expect(failed.body.code).toBe('INTERNAL');
    expect(JSON.stringify(failed.body)).not.toMatch(/uuid|syntax|sql/i);
    expect(await api.contactCount(w.orgId)).toBe(0);
    expect(await api.rows(w.orgId, `SELECT 1 FROM contact_activities WHERE org_id = $1`)).toEqual(
      [],
    );
    const sub = (await api.submissions(w.orgId, form.id))[0]!;
    expect(sub).toMatchObject({
      status: 'failed',
      reason: 'internal_error',
      idempotency_key: 'recover-key-001',
    });
    expect(sub.error).toMatch(/^INTERNAL|^[A-Z_]+:/);
    expect((await api.eventsOfType(w.orgId, 'form.submission_failed'))[0]!.payload).toMatchObject({
      reason: 'internal_error',
    });
    expect((await api.as(w.admin).get('/v2/forms')).body.data[0].needsReview).toBe(1);
    // The owner fixes the form; the visitor's retry with the same key takes the failed submission over.
    await h.owner.query(
      `UPDATE web_forms SET owner_rule = '{"mode":"unassigned","userIds":[]}'::jsonb WHERE uuid = $1::uuid`,
      [form.id],
    );
    const again = await api.submit(form.publicKey, body);
    expect(again.status).toBe(201);
    expect(again.body.submissionToken).toBe(sub.receipt_token);
    const rows = await api.submissions(w.orgId, form.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'created', error: null, reason: null });
    expect(await api.contactCount(w.orgId)).toBe(1);
  });
});

describe('analytics beacon and the embed loader', () => {
  it('events: always 204, stores a view without personal data, an unknown key looks the same, garbage is refused, and it is rate limited', async () => {
    const form = await live();
    const post = (key: string, body: unknown, ip = nextIp()) =>
      api
        .http()
        .post(`/v2/public/forms/${key}/events`)
        .set('x-forwarded-for', ip)
        .send(body as object);
    const ok = await post(form.publicKey, { visitId: 'visit-abc-12345', kind: 'view' });
    expect(ok.status).toBe(204);
    expect(ok.text).toBe('');
    expect((await post(form.publicKey, { visitId: 'visit-abc-12345', kind: 'start' })).status).toBe(
      204,
    );
    expect(
      (await post(form.publicKey, { visitId: 'visit-abc-12345', kind: 'step', step: 0 })).status,
    ).toBe(204);
    const rows = await api.rows(
      t.orgId,
      `SELECT kind, visit_id, step_index FROM web_form_events WHERE org_id = $1 AND visit_id = 'visit-abc-12345' ORDER BY id`,
    );
    expect(rows.map((r) => r.kind)).toEqual(['view', 'start', 'step']);
    expect(Object.keys(rows[0]!).sort()).toEqual(['kind', 'step_index', 'visit_id']);
    expect(
      (await post('ZzZzZzZzZzZzZzZzZzZzZz', { visitId: 'visit-abc-12345', kind: 'view' })).status,
    ).toBe(204);
    expect((await post(form.publicKey, { visitId: 'x', kind: 'view' })).status).toBe(422);
    expect(
      (await post(form.publicKey, { visitId: 'visit-abc-12345', kind: 'explode' })).status,
    ).toBe(422);
    const list = (await api.as(t.admin).get('/v2/forms?status=published')).body.data as Array<{
      id: string;
      views: number;
    }>;
    expect(list.find((f) => f.id === form.id)!.views).toBe(1);
    const closed = await live();
    await api
      .as(t.admin)
      .post(`/v2/forms/${closed.id}/pause`)
      .send({ rowVersion: closed.rowVersion });
    expect(
      (await post(closed.publicKey, { visitId: 'visit-abc-99999', kind: 'view' })).status,
    ).toBe(204);
    expect(
      await api.rows(
        t.orgId,
        `SELECT 1 FROM web_form_events WHERE org_id = $1 AND visit_id = 'visit-abc-99999'`,
      ),
    ).toEqual([]);
  });

  it('the loader is served from the API without touching the database: cached, JSON-literal values, the web origin, and a 404 script for a bad key', async () => {
    const form = await live();
    const res = await api.http().get(`/form-embed/${form.publicKey}/embed.js`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.text).toContain(JSON.stringify(form.publicKey));
    expect(res.text).toContain('"http://localhost:3001"');
    expect(res.text).toContain('e.origin !== ORIGIN || e.source !== frame.contentWindow');
    const bad = await api.http().get('/form-embed/nope/embed.js');
    expect(bad.status).toBe(404);
    expect(bad.headers['content-type']).toContain('application/javascript');
    expect(bad.text).toBe('// form not found\n');
    // The loader is framed by nobody and frames nothing: it carries no blanket frame policy; every other API route keeps its own.
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect((await api.as(t.admin).get('/v2/forms')).headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

export type { CreatedForm };
