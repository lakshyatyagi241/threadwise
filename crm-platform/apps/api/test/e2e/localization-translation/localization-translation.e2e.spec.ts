import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activeLanguagesResponseSchema,
  languageListResponseSchema,
  translationProviderListResponseSchema,
  translationSettingsSchema,
  translationUsageResponseSchema,
  type LanguageItem,
  type TranslationProviderItem,
} from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { Api, bearer, type Tenant } from '../contacts-attributes-tags/support';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * Localization and translation through HTTP: the language registry and the caller's own language, the translation
 * providers with their credentials, default and lockdown, the usage report, and a workspace's translation settings with
 * the plan gate. One app, one database; the registry and the providers are platform-wide, so each block puts back what
 * it changed.
 */
let h: Harness;
let api: Api;
let superToken = '';
let supportToken = '';

const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
const ops = (method: 'get' | 'post' | 'patch' | 'delete', path: string, token = superToken) =>
  api.http()[method](`/v2/platform/i18n${path}`).set(bearer(token));

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const first = await api
    .http()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api.http().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api
    .http()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  superToken = token;
  const support = await api
    .http()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = support.body.tokens.accessToken as string;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;

async function languages() {
  const res = await ops('get', '/languages');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return languageListResponseSchema.parse(res.body);
}
async function language(c: string): Promise<LanguageItem> {
  return (await languages()).data.find((l) => l.code === c)!;
}
const toggleLang = async (c: string) => {
  const l = await language(c);
  return ops('post', `/languages/${l.id}/toggle`).send({ rowVersion: l.rowVersion });
};

describe('language registry (TW-I18N-001 to 006)', () => {
  it('lists every language with the totals and the default, ordered, to any operator role', async () => {
    for (const token of [superToken, supportToken]) {
      const res = await ops('get', '/languages', token);
      expect(res.status).toBe(200);
      const body = languageListResponseSchema.parse(res.body);
      expect(body.data).toHaveLength(21);
      expect(body.stats).toEqual({ total: 21, active: 21, defaultCode: 'en' });
      expect(body.data[0]!.code).toBe('en');
      expect(body.data.find((l) => l.isDefault)!.code).toBe('en');
    }
  });

  it('turns a language off and on, and the public list follows at once', async () => {
    const off = await toggleLang('es');
    expect(off.status, JSON.stringify(off.body)).toBe(201);
    expect(off.body.isActive).toBe(false);
    const publicOff = activeLanguagesResponseSchema.parse(
      (await api.http().get('/v2/i18n/languages')).body,
    );
    expect(publicOff.data.map((l) => l.code)).not.toContain('es');
    expect((await languages()).stats.active).toBe(20);

    expect((await toggleLang('es')).body.isActive).toBe(true);
    const publicOn = activeLanguagesResponseSchema.parse(
      (await api.http().get('/v2/i18n/languages')).body,
    );
    expect(publicOn.data.map((l) => l.code)).toContain('es');
  });

  it('only a super admin writes, and the attempt changes nothing', async () => {
    const l = await language('fr');
    const res = await ops('post', `/languages/${l.id}/toggle`, supportToken).send({
      rowVersion: l.rowVersion,
    });
    expect(res.status).toBe(403);
    expect((await language('fr')).isActive).toBe(true);
    expect(
      (
        await api
          .http()
          .post('/v2/platform/i18n/languages/' + l.id + '/toggle')
          .send({ rowVersion: 1 })
      ).status,
    ).toBe(401);
  });

  it('refuses to switch off or delete the default language', async () => {
    const en = await language('en');
    const off = await ops('post', `/languages/${en.id}/toggle`).send({ rowVersion: en.rowVersion });
    expect(off.status).toBe(409);
    expect(code(off)).toBe('I18N_LANGUAGE_IS_DEFAULT');
    const del = await ops('delete', `/languages/${en.id}?rowVersion=${en.rowVersion}`);
    expect(del.status).toBe(409);
    expect(code(del)).toBe('I18N_LANGUAGE_IS_DEFAULT');
  });

  it('makes only an active language the default, and the stats and public default follow', async () => {
    await toggleLang('de');
    const de = await language('de');
    const refused = await ops('post', `/languages/${de.id}/default`).send({
      rowVersion: de.rowVersion,
    });
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe('I18N_LANGUAGE_INACTIVE');
    await toggleLang('de');

    const fr = await language('fr');
    const ok = await ops('post', `/languages/${fr.id}/default`).send({ rowVersion: fr.rowVersion });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await languages()).stats.defaultCode).toBe('fr');
    expect((await api.http().get('/v2/i18n/languages')).body.defaultLocale).toBe('fr');
    expect((await language('en')).isDefault).toBe(false);

    const en = await language('en');
    await ops('post', `/languages/${en.id}/default`).send({ rowVersion: en.rowVersion });
    expect((await languages()).stats.defaultCode).toBe('en');
  });

  it('edits the metadata, validates the direction, and refuses a stale version', async () => {
    const ar = await language('ar');
    const body = {
      name: 'Arabic',
      nativeName: 'العربية',
      direction: 'rtl',
      isActive: true,
      sortOrder: 4,
      rowVersion: ar.rowVersion,
    };
    const ok = await ops('patch', `/languages/${ar.id}`).send(body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ name: 'Arabic', direction: 'rtl', sortOrder: 4 });

    const bad = await ops('patch', `/languages/${ar.id}`).send({
      ...body,
      direction: 'sideways',
      rowVersion: ok.body.rowVersion,
    });
    expect(bad.status).toBe(422);

    const stale = await ops('patch', `/languages/${ar.id}`).send(body); // the old version
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
  });

  it('deactivates a language an edit leaves out only when explicit, and never the default', async () => {
    const en = await language('en');
    const res = await ops('patch', `/languages/${en.id}`).send({
      name: en.name,
      nativeName: en.nativeName,
      direction: en.direction,
      isActive: false,
      sortOrder: en.sortOrder,
      rowVersion: en.rowVersion,
    });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('I18N_LANGUAGE_IS_DEFAULT');
  });

  it('refuses to add a language, always, with a stable code', async () => {
    const res = await ops('post', '/languages').send({ code: 'xx', name: 'Klingon' });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('I18N_ADD_LANGUAGE_DISABLED');
    expect((await languages()).stats.total).toBe(21);
  });

  it('deletes a language and records who did it', async () => {
    const nl = await language('nl');
    const res = await ops('delete', `/languages/${nl.id}?rowVersion=${nl.rowVersion}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await languages()).data.map((l) => l.code)).not.toContain('nl');
    const events = await h.owner.query(
      `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.i18n.language_deleted'`,
    );
    expect(events.rows[0].n).toBe(1);
  });

  it('serves the public list to a guest with the effective default', async () => {
    const res = await api.http().get('/v2/i18n/languages');
    expect(res.status).toBe(200);
    const body = activeLanguagesResponseSchema.parse(res.body);
    expect(body.defaultLocale).toBe('en');
    expect(body.data.find((l) => l.code === 'ar')!.direction).toBe('rtl');
    expect(body.data.every((l) => !('id' in l))).toBe(true); // no internal ids on the public face
  });
});

describe("the caller's own language (TW-I18N-008, 009)", () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('loc');
  });

  it('saves an active language and says which way it reads', async () => {
    const ar = await api.as(t.admin).patch('/v2/me/locale').send({ code: 'ar' });
    expect(ar.status, JSON.stringify(ar.body)).toBe(200);
    expect(ar.body).toEqual({ ok: true, locale: 'ar', direction: 'rtl' });
    const mine = await api.as(t.admin).get('/v2/me/locale');
    expect(mine.body.userLocale).toBe('ar');
    expect((await api.as(t.admin).patch('/v2/me/locale').send({ code: 'ja' })).body.direction).toBe(
      'ltr',
    );
  });

  it('refuses a language that is not active or does not exist', async () => {
    await toggleLang('ko');
    const off = await api.as(t.admin).patch('/v2/me/locale').send({ code: 'ko' });
    expect(off.status).toBe(422);
    expect(code(off)).toBe('I18N_LANGUAGE_NOT_AVAILABLE');
    await toggleLang('ko');
    expect((await api.as(t.admin).patch('/v2/me/locale').send({ code: 'xx' })).status).toBe(422);
    expect((await api.as(t.admin).get('/v2/me/locale')).body.userLocale).toBe('ja'); // unchanged
  });

  it('is not open to a guest', async () => {
    expect((await api.http().patch('/v2/me/locale').send({ code: 'es' })).status).toBe(401);
  });
});

const providers = async (token = superToken) => {
  const res = await ops('get', '/translation-providers', token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return translationProviderListResponseSchema.parse(res.body);
};
const provider = async (slug: string): Promise<TranslationProviderItem> =>
  (await providers()).data.find((p) => p.slug === slug)!;

describe('translation providers (TW-I18N-014 to 018)', () => {
  it('lists the five seeded providers in order, MyMemory the default, no secrets', async () => {
    const { data, lockdown } = await providers(supportToken);
    expect(data.map((p) => p.slug)).toEqual([
      'mymemory',
      'google_gtx',
      'libretranslate',
      'deepl',
      'google_cloud',
    ]);
    expect(data.map((p) => [p.isActive, p.isDefault])).toEqual([
      [true, true],
      [true, false],
      [false, false],
      [false, false],
      [false, false],
    ]);
    expect(lockdown.enabled).toBe(false);
    expect(data.find((p) => p.slug === 'google_gtx')!.credentialFields).toEqual([]); // "no credentials required"
    expect(JSON.stringify(data)).not.toMatch(/api_key"?:\s*"[^"]+"/);
  });

  it('refuses to activate a provider without its required credentials, then activates it once saved', async () => {
    const deepl = await provider('deepl');
    const blocked = await ops('post', `/translation-providers/${deepl.id}/toggle`).send({
      rowVersion: deepl.rowVersion,
    });
    expect(blocked.status).toBe(409);
    expect(code(blocked)).toBe('I18N_PROVIDER_CREDENTIALS_MISSING');
    expect((await provider('deepl')).isActive).toBe(false);

    const saved = await ops('patch', `/translation-providers/${deepl.id}`).send({
      credentials: { api_key: 'deepl-secret-key:fx' },
      sortOrder: 2,
      rowVersion: deepl.rowVersion,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain('deepl-secret-key'); // never returned
    const field = saved.body.credentialFields.find((f: { key: string }) => f.key === 'api_key');
    expect(field).toMatchObject({ hasValue: true, value: null });
    expect(saved.body.sortOrder).toBe(2);

    const on = await ops('post', `/translation-providers/${deepl.id}/toggle`).send({
      rowVersion: saved.body.rowVersion,
    });
    expect(on.status, JSON.stringify(on.body)).toBe(201);
    expect(on.body.isActive).toBe(true);
  });

  it('keeps a stored secret when the field is left blank, and stores it encrypted', async () => {
    const deepl = await provider('deepl');
    const res = await ops('patch', `/translation-providers/${deepl.id}`).send({
      credentials: { api_key: '' },
      rowVersion: deepl.rowVersion,
    });
    expect(res.status).toBe(200);
    expect(res.body.credentialFields[0].hasValue).toBe(true);
    const row = (
      await h.owner.query(`SELECT credentials FROM translation_providers WHERE slug = 'deepl'`)
    ).rows[0];
    expect(String(row.credentials)).not.toContain('deepl-secret-key');
  });

  it('makes only an active provider the default, and there is always exactly one', async () => {
    const gcloud = await provider('google_cloud');
    const refused = await ops('post', `/translation-providers/${gcloud.id}/default`).send({
      rowVersion: gcloud.rowVersion,
    });
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe('I18N_PROVIDER_INACTIVE');

    const deepl = await provider('deepl');
    const ok = await ops('post', `/translation-providers/${deepl.id}/default`).send({
      rowVersion: deepl.rowVersion,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const defaults = (await providers()).data.filter((p) => p.isDefault);
    expect(defaults.map((p) => p.slug)).toEqual(['deepl']);
  });

  it('refuses a stale version', async () => {
    const mm = await provider('mymemory');
    const res = await ops('post', `/translation-providers/${mm.id}/toggle`).send({
      rowVersion: mm.rowVersion + 5,
    });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('ROW_VERSION_CONFLICT');
  });

  it('only a super admin writes', async () => {
    const mm = await provider('mymemory');
    const res = await ops('patch', `/translation-providers/${mm.id}`, supportToken).send({
      sortOrder: 9,
      rowVersion: mm.rowVersion,
    });
    expect(res.status).toBe(403);
    expect((await provider('mymemory')).sortOrder).toBe(mm.sortOrder);
  });

  it('turns the compliance lockdown on and off, skipping the free engines, and keeps the last official one on', async () => {
    const on = await ops('post', '/translation-providers/lockdown').send({ enabled: true });
    expect(on.status, JSON.stringify(on.body)).toBe(201);
    const list = translationProviderListResponseSchema.parse(on.body);
    expect(list.lockdown.enabled).toBe(true);
    expect(
      list.data
        .filter((p) => p.skippedByLockdown)
        .map((p) => p.slug)
        .sort(),
    ).toEqual(['google_gtx', 'libretranslate', 'mymemory']);

    const deepl = await provider('deepl');
    const off = await ops('post', `/translation-providers/${deepl.id}/toggle`).send({
      rowVersion: deepl.rowVersion,
    });
    expect(off.status).toBe(409);
    expect(code(off)).toBe('I18N_LOCKDOWN_NO_OFFICIAL_PROVIDER');

    const lifted = await ops('post', '/translation-providers/lockdown').send({ enabled: false });
    expect(lifted.body.lockdown.enabled).toBe(false);
    expect(lifted.body.data.some((p: TranslationProviderItem) => p.skippedByLockdown)).toBe(false);
  });

  it('refuses the lockdown when no official provider is active and configured', async () => {
    const deepl = await provider('deepl');
    await ops('post', `/translation-providers/${deepl.id}/toggle`).send({
      rowVersion: deepl.rowVersion,
    });
    const res = await ops('post', '/translation-providers/lockdown').send({ enabled: true });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('I18N_LOCKDOWN_NO_OFFICIAL_PROVIDER');
    expect((await providers()).lockdown.enabled).toBe(false);
  });
});

describe('translation usage (TW-I18N-029, 030)', () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => {
    a = await api.signup('usea');
    b = await api.signup('useb');
    const rows: Array<[number, string, number, number, number, boolean]> = [
      [a.orgId, 'deepl', 1000, 1100, 20_000, false],
      [a.orgId, 'mymemory', 500, 520, 0, true],
      [b.orgId, 'deepl', 200, 210, 4000, false],
    ];
    for (const [org, slug, cin, cout, cost, fb] of rows) {
      await h.owner.query(
        `INSERT INTO translation_usage (org_id, provider_slug, source_lang, target_lang, chars_in, chars_out, cost_micros, was_fallback) VALUES ($1,$2,'es','en',$3,$4,$5,$6)`,
        [org, slug, cin, cout, cost, fb],
      );
    }
  });

  it('totals the volume, groups by provider, and ranks the workspaces by spend', async () => {
    const res = await ops('get', '/translation-usage', supportToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = translationUsageResponseSchema.parse(res.body);
    expect(r.totals).toMatchObject({
      calls: 3,
      charsIn: 1700,
      charsOut: 1830,
      costMicros: '24000',
      fallbackHits: 1,
    });
    expect(r.byProvider.map((p) => [p.providerSlug, p.calls])).toEqual([
      ['deepl', 2],
      ['mymemory', 1],
    ]);
    expect(r.byProvider.find((p) => p.providerSlug === 'mymemory')!.ratePerMillionChars).toBe('0');
    expect(r.topWorkspaces[0]).toMatchObject({ calls: 2, charsIn: 1500, costMicros: '20000' });
    expect(r.topWorkspaces).toHaveLength(2);
    expect(r.timeline.length).toBeGreaterThan(0);
    for (const w of r.topWorkspaces) expect(w.workspaceId).toMatch(/^[0-9a-f-]{36}$/); // named by uuid, never by its internal id
  });

  it('honours a date range and rejects one that runs backwards', async () => {
    const empty = await ops('get', '/translation-usage?from=2001-01-01&to=2001-01-31');
    expect(empty.body.totals.calls).toBe(0);
    expect(empty.body.byProvider).toEqual([]);
    const bad = await ops('get', '/translation-usage?from=2026-02-01&to=2026-01-01');
    expect(bad.status).toBe(422);
  });
});

describe('workspace translation settings (TW-I18N-035)', () => {
  const setOverride = (t: Tenant, allowed: boolean) =>
    h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      t.orgId,
      JSON.stringify({ features: { translation: allowed } }),
    ]);
  const get = async (token: string) => {
    const res = await api.as(token).get('/v2/workspace/translation-settings');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return translationSettingsSchema.parse(res.body);
  };
  const patch = (token: string, body: Record<string, unknown>) =>
    api
      .as(token)
      .patch('/v2/workspace/translation-settings')
      .set('Idempotency-Key', randomUUID())
      .send(body);

  it('shows the defaults, the 22 team languages, the engine and this month usage', async () => {
    const t = await api.signup('ts1');
    await setOverride(t, true);
    await h.owner.query(
      `INSERT INTO translation_usage (org_id, provider_slug, source_lang, target_lang, chars_in, chars_out) VALUES ($1,'deepl','es','en',300,320)`,
      [t.orgId],
    );
    const s = await get(t.admin);
    expect(s).toMatchObject({ planAllows: true, enabled: true, teamLanguage: 'en', rowVersion: 0 });
    expect(s.teamLanguageOptions).toHaveLength(22);
    expect(s.usageThisMonth).toEqual({ characters: 620, calls: 1 });
    expect(s.engineName).toBeTruthy();
  });

  it('saves the language and the switch, with an audit row and an outbox event', async () => {
    const t = await api.signup('ts2');
    await setOverride(t, true);
    const res = await patch(t.admin, { teamLanguage: 'es', enabled: false, rowVersion: 0 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ teamLanguage: 'es', enabled: false });
    const row = (
      await h.owner.query(
        `SELECT default_language, inbox_translate FROM workspace_settings WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows[0];
    expect(row).toEqual({ default_language: 'es', inbox_translate: false });
    expect(await api.auditCount(t.orgId, 'translation_settings', 'insert')).toBe(1);
    expect(await api.events(t.orgId, 'translation_settings.updated')).toMatchObject([
      { teamLanguage: 'es', enabled: false },
    ]);
  });

  it('keeps what a partial save leaves out, and refuses a stale version', async () => {
    const t = await api.signup('ts3');
    await setOverride(t, true);
    const first = await patch(t.admin, { teamLanguage: 'fr', rowVersion: 0 });
    expect(first.body).toMatchObject({ teamLanguage: 'fr', enabled: true });
    const second = await patch(t.admin, { enabled: false, rowVersion: first.body.rowVersion });
    expect(second.body).toMatchObject({ teamLanguage: 'fr', enabled: false });
    expect(await api.auditCount(t.orgId, 'translation_settings', 'update')).toBe(1);
    const stale = await patch(t.admin, { enabled: true, rowVersion: first.body.rowVersion });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
  });

  it('rejects a language outside the team language list', async () => {
    const t = await api.signup('ts4');
    await setOverride(t, true);
    expect((await patch(t.admin, { teamLanguage: 'xx', rowVersion: 0 })).status).toBe(422);
    expect((await get(t.admin)).teamLanguage).toBe('en');
  });

  it('shows the upgrade state and refuses a save on a plan without translation', async () => {
    const t = await api.signup('ts5');
    await setOverride(t, false);
    const s = await get(t.admin);
    expect(s.planAllows).toBe(false);
    expect(s.engineName).toBeNull();
    const res = await patch(t.admin, { teamLanguage: 'es', rowVersion: 0 });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('PLAN_FEATURE_LOCKED');
    expect(res.body.errors).toEqual([
      { path: 'feature', message: 'translation' },
      { path: 'reason', message: 'feature_disabled' },
      { path: 'upgradeUrl', message: '/account/plans' },
    ]);
    const rows = await h.owner.query(
      `SELECT 1 FROM workspace_settings WHERE org_id = $1 AND default_language = 'es'`,
      [t.orgId],
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('needs the translation permission keys and a signed-in workspace user', async () => {
    const t = await api.signup('ts6');
    await setOverride(t, true);
    const reader = await api.member(t, 'reader', [['i18n.translation_settings.read']]);
    const nobody = await api.member(t, 'nobody', []);
    expect((await api.as(reader.token).get('/v2/workspace/translation-settings')).status).toBe(200);
    expect((await patch(reader.token, { enabled: false, rowVersion: 0 })).status).toBe(403);
    expect((await api.as(nobody.token).get('/v2/workspace/translation-settings')).status).toBe(403);
    expect((await api.http().get('/v2/workspace/translation-settings')).status).toBe(401);
    expect(
      (await api.http().get('/v2/workspace/translation-settings').set(bearer(superToken))).status,
    ).toBeGreaterThanOrEqual(401); // an operator is not a workspace user
  });

  it('keeps one workspace settings away from another', async () => {
    const a = await api.signup('ts7a');
    const b = await api.signup('ts7b');
    await setOverride(a, true);
    await setOverride(b, true);
    await patch(a.admin, { teamLanguage: 'de', rowVersion: 0 });
    expect((await get(b.admin)).teamLanguage).toBe('en');
  });
});
