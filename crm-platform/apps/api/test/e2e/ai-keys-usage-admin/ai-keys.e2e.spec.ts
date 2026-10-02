import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_PROVIDER_SLUGS,
  aiDashboardResponseSchema,
  aiModelsResponseSchema,
  aiUsageResponseSchema,
  platformAiKeysResponseSchema,
  workspaceAiKeysResponseSchema,
  type PlatformAiKeyItem,
} from '@crm/contracts';
import { AiKeyResolver, AiTokenMeter } from '../../../src/modules/ai-keys-usage-admin';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { Api, bearer, type Tenant } from '../contacts-attributes-tags/support';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * The AI keys domain end to end through HTTP and the two services other domains call: the platform's provider
 * keys, a workspace's own keys, the key-choice chain, the token ledger with its monthly cap, the two usage screens
 * and the model picker. One app, one database; every test starts from the seeded providers with no keys.
 */
let h: Harness;
let api: Api;
let superToken = '';
let supportToken = '';

const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
const ops = (method: 'get' | 'post' | 'patch' | 'delete', path: string, token = superToken) =>
  api.http()[method](`/v2/platform${path}`).set(bearer(token));

const SECRET = 'sk-test-PLATFORM-0123456789-ABCD';
const OWN = 'sk-test-WORKSPACE-9876543210-WXYZ';

const resolver = () => h.app.get(AiKeyResolver);
const meter = () => h.app.get(AiTokenMeter);

async function platformKeys() {
  const res = await ops('get', '/ai-keys');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return platformAiKeysResponseSchema.parse(res.body);
}
async function platformKey(provider: string): Promise<PlatformAiKeyItem> {
  return (await platformKeys()).data.find((k) => k.provider === provider)!;
}
/** Saves a key (and any other card fields) on a provider and returns the response body. */
async function savePlatform(provider: string, patch: Record<string, unknown>) {
  const k = await platformKey(provider);
  return ops('patch', `/ai-keys/${k.id}`).send({ rowVersion: k.rowVersion, ...patch });
}
/** A provider ready to serve: key saved (so active) with a default model. */
async function enable(provider: string, model: string, extra: Record<string, unknown> = {}) {
  const res = await savePlatform(provider, {
    apiKey: `${SECRET}-${provider}`,
    defaultModel: model,
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as PlatformAiKeyItem;
}

async function putOnPlan(t: Tenant, slug: string) {
  await h.owner.query(`UPDATE organizations SET plan = $2 WHERE id = $1`, [t.orgId, slug]);
}
async function setOverrides(t: Tenant, overrides: Record<string, unknown>) {
  await h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
    t.orgId,
    JSON.stringify(overrides),
  ]);
}
/** A workspace on a plan that does not include BYOK (the plan row exists, the flag is off). */
async function noByokTenant(label: string): Promise<Tenant> {
  const t = await api.signup(label);
  await putOnPlan(t, 'e2e_plain');
  return t;
}
async function byokTenant(label: string): Promise<Tenant> {
  const t = await noByokTenant(label);
  await setOverrides(t, { features: { allow_byok_ai_keys: true } });
  return t;
}
const saveOwn = (t: Tenant, provider: string, apiKey = OWN) =>
  api
    .as(t.admin)
    .put(`/v2/ai/provider-keys/${provider}`)
    .set('Idempotency-Key', randomUUID())
    .send({ apiKey });

async function ledger(
  t: Tenant,
  rows: Array<{
    provider: string;
    model: string | null;
    p: number;
    c: number;
    by: 'admin' | 'workspace';
    daysAgo?: number;
  }>,
) {
  for (const r of rows) {
    await h.owner.query(
      `INSERT INTO ai_token_usage (org_id, provider, model, prompt_tokens, completion_tokens, total_tokens, billed_against, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() - ($8 || ' days')::interval)`,
      [t.orgId, r.provider, r.model, r.p, r.c, r.p + r.c, r.by, String(r.daysAgo ?? 0)],
    );
  }
}

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

  // A plan row with the BYOK flag off and a monthly cap of nothing, so a workspace on it is gated for real.
  await h.owner.query(`DELETE FROM plans`);
  const plan = await ops('post', '/plans').send({
    name: 'E2E plain',
    slug: 'e2e_plain',
    isFree: true,
  });
  expect(plan.status, JSON.stringify(plan.body)).toBe(201);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

// The providers are platform-wide and shared by the file: every test starts from the seed, keyless and off.
beforeEach(async () => {
  await h.owner.query(
    `UPDATE admin_ai_keys SET api_key = NULL, key_last4 = NULL, is_active = false, extra_config = '{}',
            sort_order = array_position($1::text[], provider),
            default_model = CASE provider WHEN 'openai' THEN 'gpt-5.4-mini' WHEN 'anthropic' THEN 'claude-opus-4-8'
              WHEN 'gemini' THEN 'gemini-3.5-flash' WHEN 'mistral' THEN 'mistral-large-latest'
              WHEN 'elevenlabs' THEN 'eleven_v3' WHEN 'deepgram' THEN 'nova-2' ELSE NULL END`,
    [AI_PROVIDER_SLUGS],
  );
  await h.owner.query(`DELETE FROM ai_provider_keys`);
  await h.owner.query(`DELETE FROM ai_token_usage`);
  await h.owner.query(`DELETE FROM security_events WHERE event LIKE 'platform.ai_key.%'`);
});

describe('the platform provider list (WD-AIADM-001)', () => {
  it('shows the 22 seeded providers, none active, with the status strip', async () => {
    const res = await platformKeys();
    expect(res.data.map((k) => k.provider)).toEqual(AI_PROVIDER_SLUGS);
    expect(res.summary).toEqual({ providers: 22, active: 0, ready: 0, noKey: 22 });
    expect(res.data.every((k) => !k.isActive && !k.hasKey)).toBe(true);
  });

  it('counts active, ready and no-key apart', async () => {
    await enable('openai', 'gpt-5.4-mini');
    const mistral = await platformKey('mistral');
    await ops('patch', `/ai-keys/${mistral.id}/active`).send({ isActive: true }); // refused: no key
    const s = (await platformKeys()).summary;
    expect(s).toEqual({ providers: 22, active: 1, ready: 1, noKey: 21 });
  });

  it('is side-effect free: reading twice adds and changes nothing', async () => {
    const before = await h.owner.query(
      `SELECT count(*)::int AS n, max(updated_at) AS at FROM admin_ai_keys`,
    );
    await platformKeys();
    await platformKeys();
    const after = await h.owner.query(
      `SELECT count(*)::int AS n, max(updated_at) AS at FROM admin_ai_keys`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('is for super admins only: a support operator, a workspace user and no token are refused', async () => {
    expect((await ops('get', '/ai-keys', supportToken)).status).toBe(403);
    const t = await api.signup('keys-forbid');
    // a workspace token belongs to another identity pool: the platform API does not know it at all
    expect((await api.as(t.admin).get('/v2/platform/ai-keys')).status).toBe(401);
    expect((await api.http().get('/v2/platform/ai-keys')).status).toBe(401);
  });

  it('describes the card fields: the ceiling only on the five vendors that have it, model choices for all', async () => {
    const { data } = await platformKeys();
    expect(data.filter((k) => k.supportsMaxTokens).map((k) => k.provider)).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'mistral',
      'openrouter',
    ]);
    expect(data.find((k) => k.provider === 'deepseek')!.modelChoices).toEqual([
      'deepseek-chat',
      'deepseek-reasoner',
    ]);
  });
});

describe('saving a provider card (WD-AIADM-002, 003, 006)', () => {
  it('stores the key encrypted, switches the provider on and never returns the secret', async () => {
    const res = await savePlatform('openai', { apiKey: SECRET, defaultModel: 'gpt-5.5' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      provider: 'openai',
      isActive: true,
      hasKey: true,
      keyLast4: 'ABCD',
      defaultModel: 'gpt-5.5',
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(await platformKeys())).not.toContain(SECRET);

    const row = await h.owner.query(`SELECT api_key FROM admin_ai_keys WHERE provider = 'openai'`);
    expect(row.rows[0].api_key).toMatch(/^v1:/);
    expect(row.rows[0].api_key).not.toContain('sk-test');
  });

  it('keeps the saved key when the key field is blank and updates the model', async () => {
    await enable('openai', 'gpt-5.4-mini');
    const before = await h.owner.query(
      `SELECT api_key FROM admin_ai_keys WHERE provider = 'openai'`,
    );
    const res = await savePlatform('openai', { apiKey: '', defaultModel: 'gpt-4.1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hasKey: true, defaultModel: 'gpt-4.1' });
    const after = await h.owner.query(
      `SELECT api_key FROM admin_ai_keys WHERE provider = 'openai'`,
    );
    expect(after.rows[0].api_key).toBe(before.rows[0].api_key);
  });

  it('refuses a key longer than 1024 characters and saves nothing', async () => {
    const res = await savePlatform('openai', { apiKey: 'k'.repeat(1025), defaultModel: 'gpt-4.1' });
    expect(res.status).toBe(422);
    const k = await platformKey('openai');
    expect(k).toMatchObject({ hasKey: false, defaultModel: 'gpt-5.4-mini' });
  });

  it('does not switch a deliberately disabled provider back on when an unrelated field is saved', async () => {
    const k = await enable('openai', 'gpt-5.4-mini');
    const off = await ops('patch', `/ai-keys/${k.id}/active`).send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    const res = await savePlatform('openai', { sortOrder: 40 });
    expect(res.body).toMatchObject({ isActive: false, hasKey: true, sortOrder: 40 });
  });

  it('switches a keyless provider on when it first gets a key, and a replaced key leaves the state alone', async () => {
    expect((await enable('gemini', 'gemini-3.5-flash')).isActive).toBe(true);
    const k = await platformKey('gemini');
    await ops('patch', `/ai-keys/${k.id}/active`).send({ isActive: false });
    const again = await savePlatform('gemini', { apiKey: `${SECRET}-new` });
    expect(again.body).toMatchObject({ isActive: false, hasKey: true });
  });

  it('removes a key on request and switches the provider off with it', async () => {
    await enable('openai', 'gpt-5.4-mini');
    const res = await savePlatform('openai', { removeKey: true });
    expect(res.body).toMatchObject({ hasKey: false, isActive: false, keyLast4: null });
    const row = await h.owner.query(`SELECT api_key FROM admin_ai_keys WHERE provider = 'openai'`);
    expect(row.rows[0].api_key).toBeNull();
  });

  it('refuses a stale row version with 409 and an unknown id with 404', async () => {
    const k = await platformKey('openai');
    const first = await ops('patch', `/ai-keys/${k.id}`).send({
      rowVersion: k.rowVersion,
      defaultModel: 'gpt-4.1',
    });
    expect(first.status).toBe(200);
    const stale = await ops('patch', `/ai-keys/${k.id}`).send({
      rowVersion: k.rowVersion,
      defaultModel: 'gpt-4o',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    const none = await ops('patch', `/ai-keys/${randomUUID()}`).send({ rowVersion: 1 });
    expect(none.status).toBe(404);
  });

  it('keeps the output ceiling only on vendors that have the field, and clears it with null', async () => {
    const on = await savePlatform('openai', { maxTokens: 4096 });
    expect(on.body.maxTokens).toBe(4096);
    const ignored = await savePlatform('deepseek', { maxTokens: 4096 });
    expect(ignored.body.maxTokens).toBeNull();
    const cleared = await savePlatform('openai', { maxTokens: null });
    expect(cleared.body.maxTokens).toBeNull();
    expect((await savePlatform('openai', { maxTokens: 0 })).status).toBe(422);
  });

  it('keeps extra model ids for the pickers, trimmed and unique', async () => {
    const res = await savePlatform('openai', { extraModels: [' gpt-4o ', 'gpt-4o', 'gpt-4.1'] });
    expect(res.body.extraModels).toEqual(['gpt-4o', 'gpt-4.1']);
  });

  it('records each change as a security event without the secret', async () => {
    await enable('openai', 'gpt-5.5');
    const ev = await h.owner.query(
      `SELECT event, payload FROM security_events WHERE event LIKE 'platform.ai_key.%' ORDER BY id`,
    );
    expect(ev.rows.map((r) => r.event)).toEqual(['platform.ai_key.updated']);
    expect(ev.rows[0].payload).toMatchObject({
      provider: 'openai',
      changes: { key: 'replaced', isActive: { from: false, to: true } },
    });
    expect(JSON.stringify(ev.rows)).not.toContain('sk-test');
  });

  it('reads a stored value that no longer decrypts as no key, without failing the page', async () => {
    await enable('openai', 'gpt-5.4-mini');
    await h.owner.query(
      `UPDATE admin_ai_keys SET api_key = 'v1:AAAA:BBBB:CCCC' WHERE provider = 'openai'`,
    );
    const k = await platformKey('openai');
    expect(k).toMatchObject({ isActive: true, hasKey: false, keyUnreadable: true, keyLast4: null });
    const s = (await platformKeys()).summary;
    expect(s).toMatchObject({ active: 1, ready: 0, noKey: 22 });
    // and it cannot be switched back on until the key is pasted again
    await ops('patch', `/ai-keys/${k.id}/active`).send({ isActive: false });
    const refused = await ops('patch', `/ai-keys/${k.id}/active`).send({ isActive: true });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('AIADM_KEY_REQUIRED');
    expect((await resolver().resolve(null, 'openai')).source).toBe('none');
  });
});

describe('activating and deactivating a provider (WD-AIADM-004)', () => {
  it('refuses to activate a provider that has no key and leaves it unchanged', async () => {
    const k = await platformKey('mistral');
    const res = await ops('patch', `/ai-keys/${k.id}/active`).send({ isActive: true });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('AIADM_KEY_REQUIRED');
    expect(await platformKey('mistral')).toMatchObject({ isActive: false });
  });

  it('turns a keyed provider off and on, and asking for the state it is in changes nothing', async () => {
    await enable('openai', 'gpt-5.4-mini');
    const k = await platformKey('openai');
    const off = await ops('patch', `/ai-keys/${k.id}/active`).send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    const offAgain = await ops('patch', `/ai-keys/${k.id}/active`).send({ isActive: false });
    expect(offAgain.body.isActive).toBe(false);
    expect(
      (await ops('patch', `/ai-keys/${k.id}/active`).send({ isActive: true })).body.isActive,
    ).toBe(true);
    const ev = await h.owner.query(
      `SELECT event FROM security_events WHERE event IN ('platform.ai_key.deactivated','platform.ai_key.activated') ORDER BY id`,
    );
    expect(ev.rows.map((r) => r.event)).toEqual([
      'platform.ai_key.deactivated',
      'platform.ai_key.activated',
    ]);
  });

  it('returns 404 for an unknown provider and 422 for a body without a state', async () => {
    expect(
      (await ops('patch', `/ai-keys/${randomUUID()}/active`).send({ isActive: true })).status,
    ).toBe(404);
    const k = await platformKey('openai');
    expect((await ops('patch', `/ai-keys/${k.id}/active`).send({})).status).toBe(422);
  });
});

describe('the key-choice chain (WD-AIADM-010)', () => {
  it('uses the workspace key on a BYOK plan when both exist', async () => {
    await enable('openai', 'gpt-5.4-mini');
    const t = await byokTenant('chain-byok');
    await saveOwn(t, 'openai');
    const r = await resolver().resolve(t.orgId, 'openai');
    expect(r).toEqual({ key: OWN, source: 'workspace', model: null });
  });

  it('uses the platform key, with its default model, when the plan does not allow BYOK', async () => {
    await enable('openai', 'gpt-5.5');
    const t = await noByokTenant('chain-plain');
    await saveOwn(t, 'openai'); // stored, but ignored at resolution
    const r = await resolver().resolve(t.orgId, 'openai');
    expect(r).toEqual({ key: `${SECRET}-openai`, source: 'admin', model: 'gpt-5.5' });
  });

  it('never gates the workspace the platform owns', async () => {
    await enable('openai', 'gpt-5.5');
    const t = await noByokTenant('chain-owned');
    await saveOwn(t, 'openai');
    await h.owner.query(`UPDATE org_plan_state SET platform_owned = true WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect((await resolver().resolve(t.orgId, 'openai')).source).toBe('workspace');
  });

  it('falls back to the platform key when a BYOK workspace has none for the vendor, or has switched it off', async () => {
    await enable('anthropic', 'claude-sonnet-5');
    const t = await byokTenant('chain-fallback');
    expect((await resolver().resolve(t.orgId, 'anthropic')).source).toBe('admin');
    const saved = await saveOwn(t, 'anthropic');
    expect((await resolver().resolve(t.orgId, 'anthropic')).source).toBe('workspace');
    await api
      .as(t.admin)
      .patch(`/v2/ai/provider-keys/${saved.body.id}/active`)
      .send({ isActive: false });
    expect((await resolver().resolve(t.orgId, 'anthropic')).source).toBe('admin');
  });

  it('returns nothing when no key is usable, and treats a deactivated platform provider as gone at once', async () => {
    const t = await noByokTenant('chain-none');
    expect(await resolver().resolve(t.orgId, 'openai')).toEqual({
      key: null,
      source: 'none',
      model: null,
    });
    const k = await enable('openai', 'gpt-5.4-mini');
    expect((await resolver().resolve(t.orgId, 'openai')).source).toBe('admin');
    await ops('patch', `/ai-keys/${k.id}/active`).send({ isActive: false });
    expect((await resolver().resolve(t.orgId, 'openai')).source).toBe('none');
  });

  it('trims and lower-cases the vendor, resolves an unknown one to none, and uses only the platform key for a system call', async () => {
    await enable('openai', 'gpt-5.4-mini');
    const t = await noByokTenant('chain-slug');
    expect((await resolver().resolve(t.orgId, '  OpenAI ')).source).toBe('admin');
    expect(await resolver().resolve(t.orgId, 'no-such-vendor')).toEqual({
      key: null,
      source: 'none',
      model: null,
    });
    expect((await resolver().resolve(null, 'openai')).source).toBe('admin');
    expect(await resolver().keyFor(null, 'openai')).toBe(`${SECRET}-openai`);
  });

  it('does not let one workspace read another workspace key', async () => {
    const a = await byokTenant('chain-a');
    const b = await byokTenant('chain-b');
    await saveOwn(a, 'openai');
    expect(await resolver().resolve(b.orgId, 'openai')).toEqual({
      key: null,
      source: 'none',
      model: null,
    });
  });
});

describe('the platform output ceiling (WD-AIADM-009)', () => {
  it('lowers a request to the ceiling, leaves smaller and unlimited requests alone', async () => {
    await savePlatform('openai', { maxTokens: 1000 });
    expect(await resolver().capMaxTokens('openai', 4000)).toBe(1000);
    expect(await resolver().capMaxTokens('openai', 300)).toBe(300);
    await savePlatform('openai', { maxTokens: null });
    expect(await resolver().capMaxTokens('openai', 512)).toBe(512);
    expect(await resolver().capMaxTokens('no-such-vendor', 512)).toBe(512);
  });

  it('applies whether or not the provider is active (a workspace on its own key is capped too)', async () => {
    await savePlatform('openai', { maxTokens: 800 }); // keyless, so inactive
    expect((await platformKey('openai')).isActive).toBe(false);
    expect(await resolver().maxTokensCeiling('openai')).toBe(800);
  });
});

describe('workspace keys (WD-AIADM-011..014)', () => {
  it('lists none at first, with the plan verdict', async () => {
    const t = await noByokTenant('ws-empty');
    const res = await api.as(t.admin).get('/v2/ai/provider-keys');
    expect(res.status).toBe(200);
    const body = workspaceAiKeysResponseSchema.parse(res.body);
    expect(body).toEqual({ data: [], byokAllowed: false, sources: [] });
    expect(
      workspaceAiKeysResponseSchema.parse(
        (await api.as((await byokTenant('ws-empty2')).admin).get('/v2/ai/provider-keys')).body,
      ).byokAllowed,
    ).toBe(true);
  });

  it('adds a key encrypted, never returns it, and replaces it for the same vendor', async () => {
    const t = await byokTenant('ws-save');
    const first = await saveOwn(t, 'openai');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ provider: 'openai', isActive: true, keyLast4: 'WXYZ' });
    expect(JSON.stringify(first.body)).not.toContain(OWN);
    const row = await h.owner.query(`SELECT api_key FROM ai_provider_keys WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(row.rows[0].api_key).toMatch(/^v1:/);

    const second = await saveOwn(t, 'openai', 'sk-test-REPLACED-0000000000-1111');
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.keyLast4).toBe('1111');
    const list = workspaceAiKeysResponseSchema.parse(
      (await api.as(t.admin).get('/v2/ai/provider-keys')).body,
    );
    expect(list.data).toHaveLength(1);
    expect(list.sources).toEqual([{ provider: 'openai', source: 'workspace' }]);
    expect(JSON.stringify(list)).not.toContain('REPLACED');
  });

  it('switches a key off and on by the state asked for, and removes it for good', async () => {
    const t = await byokTenant('ws-toggle');
    const saved = await saveOwn(t, 'mistral');
    const id = saved.body.id as string;
    const off = await api
      .as(t.admin)
      .patch(`/v2/ai/provider-keys/${id}/active`)
      .send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    expect(
      (await api.as(t.admin).patch(`/v2/ai/provider-keys/${id}/active`).send({ isActive: false }))
        .body.isActive,
    ).toBe(false);
    // saving again turns it back on (the add form's behaviour)
    expect((await saveOwn(t, 'mistral')).body.isActive).toBe(true);

    const del = await api.as(t.admin).delete(`/v2/ai/provider-keys/${id}`);
    expect(del.status).toBe(204);
    const list = workspaceAiKeysResponseSchema.parse(
      (await api.as(t.admin).get('/v2/ai/provider-keys')).body,
    );
    expect(list.data).toEqual([]);
    expect((await api.as(t.admin).delete(`/v2/ai/provider-keys/${id}`)).status).toBe(404);
  });

  it('accepts one of the 22 vendors and refuses anything else, and a key that is too short', async () => {
    const t = await byokTenant('ws-validate');
    expect((await saveOwn(t, 'together')).status).toBe(422);
    expect((await saveOwn(t, 'deepgram')).status).toBe(200);
    expect((await saveOwn(t, 'openai', 'short')).status).toBe(422);
    expect((await saveOwn(t, 'openai', 'k'.repeat(1025))).status).toBe(422);
  });

  it('saves on a plan without BYOK, but says it will not be used and the platform key serves the calls', async () => {
    await enable('openai', 'gpt-5.4-mini');
    const t = await noByokTenant('ws-gated');
    expect((await saveOwn(t, 'openai')).status).toBe(200);
    const list = workspaceAiKeysResponseSchema.parse(
      (await api.as(t.admin).get('/v2/ai/provider-keys')).body,
    );
    expect(list.byokAllowed).toBe(false);
    expect(list.sources).toEqual([{ provider: 'openai', source: 'admin' }]);
  });

  it('keeps each workspace to its own keys', async () => {
    const a = await byokTenant('ws-iso-a');
    const b = await byokTenant('ws-iso-b');
    const saved = await saveOwn(a, 'openai');
    expect(
      workspaceAiKeysResponseSchema.parse((await api.as(b.admin).get('/v2/ai/provider-keys')).body)
        .data,
    ).toEqual([]);
    expect(
      (
        await api
          .as(b.admin)
          .patch(`/v2/ai/provider-keys/${saved.body.id}/active`)
          .send({ isActive: false })
      ).status,
    ).toBe(404);
    expect((await api.as(b.admin).delete(`/v2/ai/provider-keys/${saved.body.id}`)).status).toBe(
      404,
    );
    expect(
      workspaceAiKeysResponseSchema.parse((await api.as(a.admin).get('/v2/ai/provider-keys')).body)
        .data,
    ).toHaveLength(1);
  });

  it('needs the capability to manage keys, one to read them, and a workspace session at all', async () => {
    const t = await byokTenant('ws-rbac');
    const reader = await api.member(t, 'reader', [['aiadm.keys.read']]);
    expect((await api.as(reader.token).get('/v2/ai/provider-keys')).status).toBe(200);
    const denied = await api
      .as(reader.token)
      .put('/v2/ai/provider-keys/openai')
      .send({ apiKey: OWN });
    expect(denied.status).toBe(403);
    const nobody = await api.member(t, 'nobody', []);
    expect((await api.as(nobody.token).get('/v2/ai/provider-keys')).status).toBe(403);
    expect((await api.http().get('/v2/ai/provider-keys')).status).toBe(401);
    expect((await api.as(superToken).get('/v2/ai/provider-keys')).status).toBe(401); // an operator token is not a workspace session
  });

  it('writes an audit row and an outbox event for every change, with no secret in either', async () => {
    const t = await byokTenant('ws-audit');
    const saved = await saveOwn(t, 'openai');
    await api
      .as(t.admin)
      .patch(`/v2/ai/provider-keys/${saved.body.id}/active`)
      .send({ isActive: false });
    await api.as(t.admin).delete(`/v2/ai/provider-keys/${saved.body.id}`);
    const audit = await h.owner.query(
      `SELECT action, delta FROM audit_log WHERE org_id = $1 AND module = 'ai_provider_keys' ORDER BY id`,
      [t.orgId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['insert', 'update', 'delete']);
    expect(JSON.stringify(audit.rows)).not.toContain('sk-test');
    const events = await h.owner.query(
      `SELECT event_type, payload FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'ai_provider_keys' ORDER BY id`,
      [t.orgId],
    );
    expect(events.rows.map((r) => r.event_type)).toEqual([
      'ai_provider_key.saved',
      'ai_provider_key.deactivated',
      'ai_provider_key.deleted',
    ]);
    expect(JSON.stringify(events.rows)).not.toContain('sk-test');
  });
});

describe('the token ledger and the monthly cap (WD-AIADM-016..018)', () => {
  it('records a call against the side that paid, with the total as the sum', async () => {
    const t = await noByokTenant('meter-record');
    await meter().record(t.orgId, {
      provider: ' OpenAI ',
      model: 'gpt-5.4-mini',
      promptTokens: 120,
      completionTokens: 30,
      billedAgainst: 'admin',
    });
    await meter().record(t.orgId, {
      provider: 'anthropic',
      model: null,
      promptTokens: 10,
      completionTokens: 5,
      billedAgainst: 'workspace',
    });
    const rows = await h.owner.query(
      `SELECT provider, model, prompt_tokens, completion_tokens, total_tokens, billed_against FROM ai_token_usage WHERE org_id = $1 ORDER BY id`,
      [t.orgId],
    );
    expect(rows.rows).toEqual([
      {
        provider: 'openai',
        model: 'gpt-5.4-mini',
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        billed_against: 'admin',
      },
      {
        provider: 'anthropic',
        model: null,
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        billed_against: 'workspace',
      },
    ]);
  });

  it('clamps negative and fractional counts instead of failing the call that was already paid for', async () => {
    const t = await noByokTenant('meter-clamp');
    await meter().record(t.orgId, {
      provider: 'openai',
      model: 'x',
      promptTokens: -50,
      completionTokens: 7.9,
      billedAgainst: 'admin',
    });
    const row = await h.owner.query(
      `SELECT prompt_tokens, completion_tokens, total_tokens FROM ai_token_usage WHERE org_id = $1`,
      [t.orgId],
    );
    expect(row.rows[0]).toEqual({ prompt_tokens: 0, completion_tokens: 7, total_tokens: 7 });
  });

  it('refuses a ledger row with an unknown payer at the database', async () => {
    const t = await noByokTenant('meter-check');
    await expect(
      h.owner.query(
        `INSERT INTO ai_token_usage (org_id, provider, billed_against) VALUES ($1, 'openai', 'nobody')`,
        [t.orgId],
      ),
    ).rejects.toThrow(/chk_ai_token_usage_billed_against/);
  });

  it('counts only this month and only platform-key tokens toward the cap', async () => {
    const t = await noByokTenant('meter-month');
    await ledger(t, [
      { provider: 'openai', model: 'm', p: 400, c: 100, by: 'admin' },
      { provider: 'openai', model: 'm', p: 9000, c: 0, by: 'workspace' }, // own key: not counted
      { provider: 'openai', model: 'm', p: 5000, c: 0, by: 'admin', daysAgo: 62 }, // an earlier month
    ]);
    expect(await meter().usedThisMonth(t.orgId)).toBe(500);
  });

  it('lets calls through under the cap and refuses them once it is reached', async () => {
    const t = await noByokTenant('meter-guard');
    await meter().guard(t.orgId); // no cap: always fine
    await setOverrides(t, { limits: { ai_token_limit_monthly: 1000 } });
    expect(await meter().monthlyLimit(t.orgId)).toBe(1000);
    await ledger(t, [{ provider: 'openai', model: 'm', p: 600, c: 300, by: 'admin' }]);
    await meter().guard(t.orgId); // 900 < 1000
    await ledger(t, [{ provider: 'openai', model: 'm', p: 100, c: 0, by: 'admin' }]);
    const err = await meter()
      .guard(t.orgId)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toMatchObject({ code: 'PLAN_LIMIT_REACHED', status: 422 });
  });

  it('never stops a workspace that spends its own key, and never caps the platform-owned workspace', async () => {
    const t = await noByokTenant('meter-own');
    await setOverrides(t, { limits: { ai_token_limit_monthly: 100 } });
    await ledger(t, [{ provider: 'openai', model: 'm', p: 5000, c: 0, by: 'workspace' }]);
    await meter().guard(t.orgId);
    await ledger(t, [{ provider: 'openai', model: 'm', p: 5000, c: 0, by: 'admin' }]);
    await h.owner.query(`UPDATE org_plan_state SET platform_owned = true WHERE org_id = $1`, [
      t.orgId,
    ]);
    await meter().guard(t.orgId);
  });
});

describe('the workspace usage screen (WD-AIADM-025..027)', () => {
  it('summarises a window: totals, the two payers, the provider and model mix, a daily series and the cost estimate', async () => {
    const t = await noByokTenant('usage-main');
    await ledger(t, [
      { provider: 'openai', model: 'gpt-5.4-mini', p: 600, c: 400, by: 'admin' },
      { provider: 'openai', model: 'gpt-5.4-mini', p: 500, c: 500, by: 'admin', daysAgo: 2 },
      {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        p: 100,
        c: 100,
        by: 'workspace',
        daysAgo: 1,
      },
      {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        p: 50,
        c: 50,
        by: 'workspace',
        daysAgo: 40,
      }, // outside 30d
    ]);
    const res = await api.as(t.admin).get('/v2/ai/usage?window=30d');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = aiUsageResponseSchema.parse(res.body);
    expect(body.window).toBe('30d');
    expect(body.kpis).toEqual({
      tokens: 2200,
      calls: 3,
      platformTokens: 2000,
      ownKeyTokens: 200,
      estimatedCostUsd: '0.01',
      providers: 2,
      models: 2,
    });
    expect(body.sourceSplit).toEqual({ admin: 2000, workspace: 200 });
    expect(body.byProvider).toEqual([
      { provider: 'openai', tokens: 2000, calls: 2 },
      { provider: 'anthropic', tokens: 200, calls: 1 },
    ]);
    expect(body.byModel[0]).toMatchObject({
      model: 'gpt-5.4-mini',
      provider: 'openai',
      tokens: 2000,
      calls: 2,
      promptTokens: 1100,
      completionTokens: 900,
    });
    expect(body.daily).toHaveLength(30);
    expect(body.daily.reduce((s, d) => s + d.tokens, 0)).toBe(2200);
    expect(body.daily.at(-1)!.date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('defaults to 30 days, widens with the window, and refuses an unknown one', async () => {
    const t = await noByokTenant('usage-window');
    await ledger(t, [
      { provider: 'openai', model: 'm', p: 10, c: 0, by: 'admin' },
      { provider: 'openai', model: 'm', p: 20, c: 0, by: 'admin', daysAgo: 40 },
    ]);
    const def = aiUsageResponseSchema.parse((await api.as(t.admin).get('/v2/ai/usage')).body);
    expect(def.window).toBe('30d');
    expect(def.kpis.tokens).toBe(10);
    const wide = aiUsageResponseSchema.parse(
      (await api.as(t.admin).get('/v2/ai/usage?window=90d')).body,
    );
    expect(wide.kpis.tokens).toBe(30);
    expect(wide.daily).toHaveLength(90);
    expect(
      aiUsageResponseSchema.parse((await api.as(t.admin).get('/v2/ai/usage?window=7d')).body).daily,
    ).toHaveLength(7);
    expect(
      aiUsageResponseSchema.parse((await api.as(t.admin).get('/v2/ai/usage?window=1y')).body).daily,
    ).toHaveLength(365);
    expect((await api.as(t.admin).get('/v2/ai/usage?window=2d')).status).toBe(422);
  });

  it('is all zeros for a workspace that has used nothing', async () => {
    const t = await noByokTenant('usage-empty');
    const body = aiUsageResponseSchema.parse((await api.as(t.admin).get('/v2/ai/usage')).body);
    expect(body.kpis).toMatchObject({ tokens: 0, calls: 0, estimatedCostUsd: '0.00' });
    expect(body.byProvider).toEqual([]);
    expect(body.cap).toEqual({ used: 0, limit: null, percent: 0, reached: false });
  });

  it('shows the monthly cap meter against the plan cap, platform-key tokens only', async () => {
    const t = await noByokTenant('usage-cap');
    await setOverrides(t, { limits: { ai_token_limit_monthly: 1000 } });
    await ledger(t, [
      { provider: 'openai', model: 'm', p: 250, c: 0, by: 'admin' },
      { provider: 'openai', model: 'm', p: 700, c: 0, by: 'workspace' },
    ]);
    const body = aiUsageResponseSchema.parse((await api.as(t.admin).get('/v2/ai/usage')).body);
    expect(body.cap).toEqual({ used: 250, limit: 1000, percent: 25, reached: false });
    await ledger(t, [{ provider: 'openai', model: 'm', p: 900, c: 0, by: 'admin' }]);
    const over = aiUsageResponseSchema.parse((await api.as(t.admin).get('/v2/ai/usage')).body);
    expect(over.cap).toEqual({ used: 1150, limit: 1000, percent: 100, reached: true });
  });

  it('shows a workspace only its own rows', async () => {
    const a = await noByokTenant('usage-a');
    const b = await noByokTenant('usage-b');
    await ledger(a, [{ provider: 'openai', model: 'm', p: 111, c: 0, by: 'admin' }]);
    await ledger(b, [{ provider: 'openai', model: 'm', p: 222, c: 0, by: 'admin' }]);
    expect(
      aiUsageResponseSchema.parse((await api.as(a.admin).get('/v2/ai/usage')).body).kpis.tokens,
    ).toBe(111);
    expect(
      aiUsageResponseSchema.parse((await api.as(b.admin).get('/v2/ai/usage')).body).kpis.tokens,
    ).toBe(222);
  });

  it('needs the usage capability', async () => {
    const t = await noByokTenant('usage-rbac');
    const nobody = await api.member(t, 'nobody', [['aiadm.keys.read']]);
    expect((await api.as(nobody.token).get('/v2/ai/usage')).status).toBe(403);
    const reader = await api.member(t, 'usage-reader', [['aiadm.usage.read']]);
    expect((await api.as(reader.token).get('/v2/ai/usage')).status).toBe(200);
  });
});

describe('the platform AI dashboard (WD-AIADM-020..024)', () => {
  it('totals every workspace, ranks the busiest, and reports key health and BYOK counts', async () => {
    const a = await byokTenant('dash-a');
    const b = await noByokTenant('dash-b');
    await h.owner.query(`UPDATE organizations SET name = 'Alpha Org' WHERE id = $1`, [a.orgId]);
    await ledger(a, [
      { provider: 'openai', model: 'gpt-5.4-mini', p: 3000, c: 1000, by: 'admin' },
      { provider: 'anthropic', model: 'claude-sonnet-5', p: 500, c: 500, by: 'workspace' },
    ]);
    await ledger(b, [{ provider: 'openai', model: 'gpt-5.4-mini', p: 100, c: 100, by: 'admin' }]);
    await enable('openai', 'gpt-5.4-mini');
    await saveOwn(a, 'anthropic');
    await saveOwn(a, 'openai');

    const res = await ops('get', '/ai-dashboard?window=7d');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = aiDashboardResponseSchema.parse(res.body);
    expect(body.window).toBe('7d');
    expect(body.kpis).toMatchObject({
      tokens: 5200,
      calls: 3,
      platformTokens: 4200,
      ownKeyTokens: 1000,
      providers: 2,
      workspaces: 2,
    });
    expect(body.daily).toHaveLength(7);
    expect(body.byProvider).toEqual([
      { provider: 'openai', tokens: 4200, calls: 2 },
      { provider: 'anthropic', tokens: 1000, calls: 1 },
    ]);
    expect(body.topWorkspaces.map((w) => [w.name, w.tokens, w.ownKeyTokens])).toEqual([
      ['Alpha Org', 5000, 1000],
      [expect.any(String), 200, 0],
    ]);
    expect(body.topWorkspaces[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.keys.platform.find((k) => k.provider === 'openai')).toEqual({
      provider: 'openai',
      defaultModel: 'gpt-5.4-mini',
      live: true,
    });
    expect(body.keys.platform.find((k) => k.provider === 'mistral')!.live).toBe(false);
    expect(body.keys.byok).toEqual({
      count: 2,
      workspaces: 1,
      byProvider: { anthropic: 1, openai: 1 },
    });
  });

  it('shows a provider that is active but unreadable as not live', async () => {
    await enable('openai', 'gpt-5.4-mini');
    await h.owner.query(
      `UPDATE admin_ai_keys SET api_key = 'v1:AAAA:BBBB:CCCC' WHERE provider = 'openai'`,
    );
    const body = aiDashboardResponseSchema.parse((await ops('get', '/ai-dashboard')).body);
    expect(body.keys.platform.find((k) => k.provider === 'openai')!.live).toBe(false);
  });

  it('is empty, not an error, before any call was metered', async () => {
    const body = aiDashboardResponseSchema.parse((await ops('get', '/ai-dashboard')).body);
    expect(body.kpis).toMatchObject({
      tokens: 0,
      calls: 0,
      estimatedCostUsd: '0.00',
      workspaces: 0,
    });
    expect(body.topWorkspaces).toEqual([]);
  });

  it('may be read by any operator role, and by no workspace user', async () => {
    expect((await ops('get', '/ai-dashboard', supportToken)).status).toBe(200);
    const t = await noByokTenant('dash-forbid');
    expect((await api.as(t.admin).get('/v2/platform/ai-dashboard')).status).toBe(401);
    expect((await ops('get', '/ai-dashboard?window=bad')).status).toBe(422);
  });
});

describe('the model picker (WD-AIADM-015)', () => {
  const picker = async (t: Tenant) =>
    aiModelsResponseSchema.parse((await api.as(t.admin).get('/v2/ai/models')).body).data;

  it('lists the models of active, keyed text providers: the default first, then the extras', async () => {
    await enable('openai', 'gpt-5.5', { extraModels: ['gpt-4o', 'gpt-5.5'] });
    await enable('mistral', 'mistral-small-latest');
    await savePlatform('gemini', { defaultModel: 'gemini-2.5-pro' }); // no key: not offered
    const t = await noByokTenant('pick-platform');
    const list = await picker(t);
    expect(list.map((m) => `${m.provider}:${m.value}`)).toEqual([
      'openai:gpt-5.5',
      'openai:gpt-4o',
      'mistral:mistral-small-latest',
    ]);
    expect(list.every((m) => m.source === 'platform')).toBe(true);
    expect(list[0]!.providerName).toBe('OpenAI');
  });

  it('leaves the voice vendors out and skips a provider with no default model', async () => {
    await enable('elevenlabs', 'eleven_v3');
    await enable('deepgram', 'nova-2');
    await enable('deepseek', 'deepseek-chat');
    await h.owner.query(
      `UPDATE admin_ai_keys SET default_model = NULL WHERE provider = 'deepseek'`,
    );
    expect(await picker(await noByokTenant('pick-voice'))).toEqual([]);
  });

  it('shows a BYOK workspace its own vendor models in place of the platform ones', async () => {
    await enable('openai', 'gpt-5.5');
    await enable('anthropic', 'claude-sonnet-5');
    const t = await byokTenant('pick-byok');
    await saveOwn(t, 'anthropic');
    const list = await picker(t);
    expect(list.filter((m) => m.provider === 'openai').every((m) => m.source === 'platform')).toBe(
      true,
    );
    const own = list.filter((m) => m.provider === 'anthropic');
    expect(own.map((m) => m.value)).toEqual(['claude-opus-5', 'claude-fable-5']);
    expect(own.every((m) => m.source === 'workspace')).toBe(true);
  });

  it('does not advertise a stored own key the plan would not let a call use', async () => {
    await enable('anthropic', 'claude-sonnet-5');
    const t = await noByokTenant('pick-gated');
    await saveOwn(t, 'anthropic');
    const list = await picker(t);
    expect(list.map((m) => [m.provider, m.source, m.value])).toEqual([
      ['anthropic', 'platform', 'claude-sonnet-5'],
    ]);
  });

  it('needs aiadm.models.read (every preset holds it), and is closed to everybody else', async () => {
    const t = await noByokTenant('pick-auth');
    const nobody = await api.member(t, 'nobody', []);
    expect((await api.as(nobody.token).get('/v2/ai/models')).status).toBe(403);
    const reader = await api.member(t, 'reader', [['aiadm.models.read']]);
    expect((await api.as(reader.token).get('/v2/ai/models')).status).toBe(200);
    expect((await api.http().get('/v2/ai/models')).status).toBe(401);
    expect((await api.as(superToken).get('/v2/ai/models')).status).toBe(401);
  });
});
