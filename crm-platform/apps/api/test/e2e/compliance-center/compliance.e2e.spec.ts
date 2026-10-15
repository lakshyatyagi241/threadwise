import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * The Compliance center end to end (BL-172 to BL-179): the real API, real Postgres (restricted role, forced RLS) and Redis. Settings with
 * the country suggestion and the optimistic lock, the sub-processor list, the privacy and terms links on a consent notice (additive,
 * versioned), the workspace default notice, the checklist read from workspace data, the optional public page, the permissions and the
 * isolation between two workspaces.
 */
let h: Harness;
let api: Api;
let a: Tenant;
let b: Tenant;

const q = async (sql: string, params: unknown[] = []) => (await h.owner.query(sql, params)).rows;

const settings = (t: Tenant) => api.as(t.admin).get('/v2/compliance/settings');
const checklist = async (t: Tenant) => (await api.as(t.admin).get('/v2/compliance/checklist')).body;
const item = (c: { items: Array<{ id: string }> }, id: string) =>
  c.items.find((i) => i.id === id) as unknown as {
    status: string;
    detail: string;
    regimes: string[];
  };

/** The whole document the screen sends back, with edits on top. */
async function save(t: Tenant, edit: Record<string, unknown> = {}) {
  const cur = (await settings(t)).body;
  const {
    suggestion: _s,
    workspaceTimezone: _w,
    regimesConfirmedAt: _c,
    updatedAt: _u,
    ...doc
  } = cur;
  // The first save carries no version: the document read has `rowVersion: null`, which the schema does not accept.
  if (doc.rowVersion === null) delete doc.rowVersion;
  return api
    .as(t.admin)
    .patch('/v2/compliance/settings')
    .send({ ...doc, ...edit });
}

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  a = await api.signup('cmpa');
  b = await api.signup('cmpb');
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('settings and the country suggestion', () => {
  it('a new workspace has the defaults, nothing switched on and no suggestion without a country', async () => {
    const res = await settings(a);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      regimes: [],
      regimesConfirmedAt: null,
      rowVersion: null,
      childrenPolicy: 'unset',
      dndRegistry: 'none',
      subprocessorsPublic: false,
      suggestion: { country: null, source: null, regimes: [] },
    });
  });

  it('the onboarding country suggests profiles, the billing country wins, and neither switches anything on', async () => {
    await q(
      `UPDATE organizations SET settings = settings || '{"country":"IN"}'::jsonb WHERE id = $1`,
      [a.orgId],
    );
    let res = await settings(a);
    expect(res.body.suggestion).toEqual({
      country: 'IN',
      source: 'onboarding',
      regimes: ['dpdp_in', 'trai_in'],
    });
    expect(res.body.regimes).toEqual([]);

    await q(
      `INSERT INTO orders (org_id, order_number, kind, description, currency, amount, status, billing_country, paid_at)
       VALUES ($1, $2, 'manual', 'Test order', 'EUR', 10, 'paid', 'Germany', now())`,
      [a.orgId, `CMP-${Date.now()}`],
    );
    res = await settings(a);
    expect(res.body.suggestion).toEqual({ country: 'DE', source: 'billing', regimes: ['gdpr_eu'] });
    expect(res.body.regimes).toEqual([]);
  });

  it('the first save needs no version, confirms the choice, and a second save without one is a 409', async () => {
    const first = await save(a, {
      regimes: ['dpdp_in', 'trai_in'],
      privacyUrl: 'https://acme.test/privacy',
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.regimes).toEqual(['dpdp_in', 'trai_in']);
    expect(first.body.regimesConfirmedAt).not.toBeNull();
    expect(first.body.rowVersion).toBe(1);

    const again = await save(a, { rowVersion: undefined });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ROW_VERSION_CONFLICT');
  });

  it('a save with the version read works, bumps it, and a stale version is a 409', async () => {
    const cur = (await settings(a)).body;
    const ok = await save(a, {
      rowVersion: cur.rowVersion,
      childrenPolicy: 'may_include_minors',
      parentalConsentRequired: true,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.rowVersion).toBe(cur.rowVersion + 1);
    const stale = await save(a, { rowVersion: cur.rowVersion });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
  });

  it('refuses a window that ends before it starts and an unknown zone with 422 COMPLIANCE_SETTINGS_INVALID, and a link that is not https', async () => {
    const cur = (await settings(a)).body;
    const bad = await save(a, {
      rowVersion: cur.rowVersion,
      callingWindow: { enabled: true, start: '21:00', end: '08:00', days: [1] },
      windowTimezone: 'Mars/Olympus',
    });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('COMPLIANCE_SETTINGS_INVALID');
    const paths = (bad.body.errors ?? []).map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['callingWindow.end', 'windowTimezone']));

    const http = await save(a, { rowVersion: cur.rowVersion, termsUrl: 'http://acme.test/terms' });
    expect(http.status).toBeGreaterThanOrEqual(400);
    expect(http.status).toBeLessThan(500);
    expect((await settings(a)).body.rowVersion).toBe(cur.rowVersion);
  });

  it('stores the quiet hours, the calling window and the DND choice, audited without the officer contact', async () => {
    const cur = (await settings(a)).body;
    const res = await save(a, {
      rowVersion: cur.rowVersion,
      quietHours: { enabled: true, start: '21:00', end: '09:00' },
      callingWindow: { enabled: true, start: '09:00', end: '21:00', days: [1, 2, 3, 4, 5] },
      windowTimezone: 'Asia/Kolkata',
      dndRegistry: 'trai_ndnc',
      dpo: { name: 'Sam Rao', email: 'sam.rao@acme.test', phone: '', address: '' },
      grievanceOfficer: {
        name: 'Asha Nair',
        email: 'asha@acme.test',
        phone: '+911234567890',
        address: '',
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.callingWindow).toEqual({
      enabled: true,
      start: '09:00',
      end: '21:00',
      days: [1, 2, 3, 4, 5],
    });
    expect(res.body.dndRegistry).toBe('trai_ndnc');
    expect(res.body.dpo.email).toBe('sam.rao@acme.test');

    const audit = await q(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'compliance_settings' ORDER BY id`,
      [a.orgId],
    );
    expect(audit.length).toBeGreaterThanOrEqual(3);
    const all = JSON.stringify(audit);
    expect(all).not.toContain('sam.rao@acme.test');
    expect(all).not.toContain('Asha Nair');
    const events = await api.events(a.orgId, 'compliance.settings_changed');
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it('is isolated per workspace', async () => {
    const other = await settings(b);
    expect(other.body).toMatchObject({ regimes: [], rowVersion: null, privacyUrl: null });
    expect(
      (
        await q(`SELECT count(*)::int AS n FROM compliance_settings WHERE org_id = $1`, [b.orgId])
      )[0].n,
    ).toBe(0);
  });
});

describe('permissions', () => {
  it('read-only holders see the settings and the checklist but cannot save; people without the keys get 403', async () => {
    const reader = await api.member(a, 'cmpread', [['settings.compliance.read']]);
    const none = await api.member(a, 'cmpnone', [['record.forms.read']]);
    expect((await api.as(reader.token).get('/v2/compliance/settings')).status).toBe(200);
    expect((await api.as(reader.token).get('/v2/compliance/checklist')).status).toBe(200);
    expect((await api.as(reader.token).get('/v2/compliance/subprocessors')).status).toBe(200);
    const cur = (await settings(a)).body;
    const write = await api
      .as(reader.token)
      .patch('/v2/compliance/settings')
      .send({ ...cur, rowVersion: cur.rowVersion });
    expect(write.status).toBe(403);
    expect(
      (await api.as(reader.token).post('/v2/compliance/subprocessors').send({ name: 'X' })).status,
    ).toBe(403);
    for (const path of [
      '/v2/compliance/settings',
      '/v2/compliance/checklist',
      '/v2/compliance/links',
    ]) {
      expect((await api.as(none.token).get(path)).status, path).toBe(403);
    }
  });

  it('the links route is readable by someone who edits a form or a consent notice, and nothing else is', async () => {
    const forms = await api.member(a, 'cmpform', [['record.forms.update']]);
    const consent = await api.member(a, 'cmpcons', [['settings.consent.manage']]);
    const links = await api.as(forms.token).get('/v2/compliance/links');
    expect(links.status).toBe(200);
    expect(links.body).toMatchObject({ privacyUrl: 'https://acme.test/privacy', termsUrl: null });
    expect((await api.as(consent.token).get('/v2/compliance/links')).status).toBe(200);
    expect((await api.as(forms.token).get('/v2/compliance/settings')).status).toBe(403);
  });
});

describe('sub-processors', () => {
  let id = '';
  let version = 0;

  it('adds one, lists it, refuses a duplicate name in any capitalisation', async () => {
    const res = await api.as(a.admin).post('/v2/compliance/subprocessors').send({
      name: 'Mailer Co',
      purpose: 'Email delivery',
      dataCategories: 'Email addresses',
      location: 'Ireland',
      websiteUrl: 'https://mailer.test',
      dpaUrl: null,
      status: 'active',
      addedOn: '2026-10-01',
      noticeSentOn: null,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Mailer Co',
      location: 'Ireland',
      status: 'active',
      addedOn: '2026-10-01',
      rowVersion: 1,
    });
    id = res.body.id;
    version = res.body.rowVersion;
    const list = await api.as(a.admin).get('/v2/compliance/subprocessors');
    expect(list.body.data).toHaveLength(1);
    const dup = await api.as(a.admin).post('/v2/compliance/subprocessors').send({
      name: '  mailer co ',
      purpose: '',
      dataCategories: '',
      location: '',
      websiteUrl: null,
      dpaUrl: null,
      status: 'active',
      addedOn: null,
      noticeSentOn: null,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('COMPLIANCE_SUBPROCESSOR_DUPLICATE');
  });

  it('changes it with the version read, refuses a stale one, and audits the change', async () => {
    const body = {
      name: 'Mailer Co',
      purpose: 'Email and SMS delivery',
      dataCategories: 'Email addresses',
      location: 'Ireland',
      websiteUrl: 'https://mailer.test',
      dpaUrl: 'https://mailer.test/dpa',
      status: 'active',
      addedOn: '2026-10-01',
      noticeSentOn: '2026-10-02',
    };
    const ok = await api
      .as(a.admin)
      .patch(`/v2/compliance/subprocessors/${id}`)
      .send({ ...body, rowVersion: version });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.rowVersion).toBe(version + 1);
    expect(ok.body.dpaUrl).toBe('https://mailer.test/dpa');
    const stale = await api
      .as(a.admin)
      .patch(`/v2/compliance/subprocessors/${id}`)
      .send({ ...body, rowVersion: version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    version = ok.body.rowVersion;
    expect(
      (
        await q(
          `SELECT 1 FROM audit_log WHERE org_id = $1 AND module = 'compliance_subprocessors' AND action = 'update'`,
          [a.orgId],
        )
      ).length,
    ).toBe(1);
  });

  it('another workspace cannot see, change or remove it', async () => {
    expect((await api.as(b.admin).get('/v2/compliance/subprocessors')).body.data).toEqual([]);
    const patch = await api.as(b.admin).patch(`/v2/compliance/subprocessors/${id}`).send({
      name: 'Hijack',
      purpose: '',
      dataCategories: '',
      location: '',
      websiteUrl: null,
      dpaUrl: null,
      status: 'active',
      addedOn: null,
      noticeSentOn: null,
      rowVersion: version,
    });
    expect(patch.status).toBe(404);
    expect(patch.body.code).toBe('COMPLIANCE_SUBPROCESSOR_NOT_FOUND');
    expect((await api.as(b.admin).delete(`/v2/compliance/subprocessors/${id}`)).status).toBe(404);
    expect(
      (await q(`SELECT name FROM compliance_subprocessors WHERE org_id = $1`, [a.orgId]))[0].name,
    ).toBe('Mailer Co');
  });
});

describe('consent notices: terms link and the workspace default', () => {
  const put = (t: Tenant, scope: string, ref: string, body: Record<string, unknown>) =>
    api.as(t.admin).put(`/v2/contact-consent/notices/${scope}/${ref}`).send(body);

  it('an old client that sends no termsUrl keeps working: the link is null', async () => {
    const res = await put(a, 'workspace', 'en', {
      enabled: true,
      text: 'We use your details to answer you.',
      url: 'https://acme.test/privacy',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      scope: 'workspace',
      ref: 'en',
      version: 1,
      url: 'https://acme.test/privacy',
      termsUrl: null,
    });
  });

  it('a terms link is a new version; the same save writes nothing; a link that is not https is refused', async () => {
    const withTerms = {
      enabled: true,
      text: 'We use your details to answer you.',
      url: 'https://acme.test/privacy',
      termsUrl: 'https://acme.test/terms',
    };
    const v2 = await put(a, 'workspace', 'en', withTerms);
    expect(v2.body).toMatchObject({ version: 2, termsUrl: 'https://acme.test/terms' });
    const same = await put(a, 'workspace', 'en', withTerms);
    expect(same.body.version).toBe(2);
    expect(
      (await put(a, 'workspace', 'en', { ...withTerms, termsUrl: 'http://acme.test/terms' }))
        .status,
    ).toBeGreaterThanOrEqual(400);
    const rows = await q(
      `SELECT version, terms_url FROM consent_notices WHERE org_id = $1 AND scope = 'workspace' AND scope_ref = 'en' ORDER BY version`,
      [a.orgId],
    );
    expect(rows.map((r) => [r.version, r.terms_url])).toEqual([
      [1, null],
      [2, 'https://acme.test/terms'],
    ]);
  });

  it('a second language is its own notice; a malformed language is a 404; another workspace has none', async () => {
    const hi = await put(a, 'workspace', 'hi', {
      enabled: true,
      text: 'हम आपकी जानकारी का उपयोग आपको उत्तर देने के लिए करते हैं।',
      url: null,
    });
    expect(hi.status, JSON.stringify(hi.body)).toBe(200);
    expect(hi.body).toMatchObject({ ref: 'hi', version: 1 });
    expect(
      (await put(a, 'workspace', 'not a locale', { enabled: false, text: '', url: null })).status,
    ).toBe(404);
    expect(
      (await api.as(b.admin).get('/v2/contact-consent/notices/workspace/en')).body,
    ).toMatchObject({ version: 0, enabled: false, text: '' });
  });

  it('the links route offers the workspace link and the current English wording', async () => {
    const res = await api.as(a.admin).get('/v2/compliance/links');
    expect(res.body).toEqual({
      privacyUrl: 'https://acme.test/privacy',
      termsUrl: null,
      noticeText: 'We use your details to answer you.',
    });
  });
});

describe('the checklist reads the workspace data', () => {
  it('shows the baseline and the rows of the profiles that are on, none of them as compliant', async () => {
    const c = await checklist(a);
    expect(c.regimes).toEqual(['dpdp_in', 'trai_in']);
    expect(c.items.filter((i: { scope: string }) => i.scope === 'baseline')).toHaveLength(9);
    expect(item(c, 'subprocessors').status).toBe('built');
    expect(item(c, 'notices').status).toBe('built');
    expect(item(c, 'children').status).toBe('built');
    expect(item(c, 'grievance_officer').status).toBe('built');
    // English is written, the second language is not named yet.
    expect(item(c, 'notice_languages')).toMatchObject({ status: 'partial', detail: 'noSecond' });
    expect(item(c, 'quiet_hours').status).toBe('built');
    expect(item(c, 'windows_enforcement')).toMatchObject({
      status: 'partial',
      detail: 'notEnforced',
    });
    expect(JSON.stringify(c)).not.toMatch(/compliant/i);
  });

  it('follows the data: naming the second language and writing its notice completes the DPDP row; an overdue request makes rights partial', async () => {
    const cur = (await settings(a)).body;
    expect(
      (await save(a, { rowVersion: cur.rowVersion, secondaryNoticeLocale: 'hi' })).status,
    ).toBe(200);
    expect(item(await checklist(a), 'notice_languages').status).toBe('built');

    await q(
      `INSERT INTO privacy_requests (org_id, request_type, status, subject_kind, subject_identifier_kind, subject_label, due_at)
       VALUES ($1, 'access', 'received', 'identifier', 'email', 'x***', now() - interval '2 days')`,
      [a.orgId],
    );
    expect(item(await checklist(a), 'rights')).toMatchObject({
      status: 'partial',
      detail: 'overdue',
    });
  });

  it('a workspace that never saved is checked against the baseline alone', async () => {
    const c = await checklist(b);
    expect(c.regimes).toEqual([]);
    expect(c.items.every((i: { scope: string }) => i.scope === 'baseline')).toBe(true);
    expect(item(c, 'subprocessors').status).toBe('open');
  });
});

describe('the optional public page', () => {
  const page = (slug: string) => api.http().get(`/v2/public/compliance/trust/${slug}`);

  it('is a 404 until the workspace switches it on, and for an unknown or malformed slug', async () => {
    expect((await page(a.slug)).status).toBe(404);
    expect((await page('no-such-workspace')).status).toBe(404);
    expect((await page('bad slug!')).status).toBe(404);
    expect((await page(b.slug)).status).toBe(404);
  });

  it('shows only the active vendors and the published links, with no ids or internal fields', async () => {
    await api.as(a.admin).post('/v2/compliance/subprocessors').send({
      name: 'Retired Vendor',
      purpose: 'Old',
      dataCategories: '',
      location: 'Nowhere',
      websiteUrl: null,
      dpaUrl: null,
      status: 'removed',
      addedOn: null,
      noticeSentOn: null,
    });
    const cur = (await settings(a)).body;
    expect((await save(a, { rowVersion: cur.rowVersion, subprocessorsPublic: true })).status).toBe(
      200,
    );
    const res = await page(a.slug);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.privacyUrl).toBe('https://acme.test/privacy');
    expect(res.body.subprocessors).toEqual([
      {
        name: 'Mailer Co',
        purpose: 'Email and SMS delivery',
        dataCategories: 'Email addresses',
        location: 'Ireland',
        websiteUrl: 'https://mailer.test',
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('Retired Vendor');
    expect(res.body.id).toBeUndefined();
  });

  it('removing the last active vendor leaves an empty list, and switching it off closes the page again', async () => {
    const list = (await api.as(a.admin).get('/v2/compliance/subprocessors')).body.data as Array<{
      id: string;
      name: string;
    }>;
    const mailer = list.find((s) => s.name === 'Mailer Co')!;
    expect((await api.as(a.admin).delete(`/v2/compliance/subprocessors/${mailer.id}`)).status).toBe(
      204,
    );
    expect((await page(a.slug)).body.subprocessors).toEqual([]);
    const cur = (await settings(a)).body;
    expect((await save(a, { rowVersion: cur.rowVersion, subprocessorsPublic: false })).status).toBe(
      200,
    );
    expect((await page(a.slug)).status).toBe(404);
  });
});
