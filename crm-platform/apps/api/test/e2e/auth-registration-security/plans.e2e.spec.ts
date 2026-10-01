import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  onboardingResponseSchema,
  planAdminItemSchema,
  planAdminListResponseSchema,
  plansResponseSchema,
  readPlanLock,
  type PlanAdminItem,
  type PlanCard,
} from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD, startHarness, type Harness } from './harness';

/**
 * The plans slice of the PLAN domain end to end through HTTP: the operator's
 * catalogue, the registration default, the plan and trial a new organization
 * starts with, the branding gate, and the plan cards on the onboarding step
 * and GET /v2/plans. One app, one database; every test starts from an empty
 * catalogue and the default registration settings.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Str0ngPassw0rd#1';
const DAY = 86_400_000;

let ipCounter = 10;
const nextIp = () => `10.7.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
let emailCounter = 0;
const uniqueEmail = () => `plans${Date.now()}${emailCounter++}@example.test`;
let slugCounter = 0;
const slugOf = (base: string) => `${base}_${++slugCounter}`;

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let superToken = '';
let supportToken = '';
let operatorId = 0;

type Method = 'get' | 'post' | 'patch' | 'delete';
/** A platform request as the super admin. */
const ops = (method: Method, path: string) =>
  api()[method](`/v2/platform${path}`).set(bearer(superToken));
/** A platform request as the (read-only) support operator. */
const support = (method: Method, path: string) =>
  api()[method](`/v2/platform${path}`).set(bearer(supportToken));

interface Account {
  email: string;
  slug: string;
  access: string;
  orgId: number;
}

async function signup(): Promise<Account> {
  const email = uniqueEmail();
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', nextIp())
    .send({
      orgName: `Plans Org ${emailCounter}`,
      fullName: 'Plan Person',
      email,
      password: PASSWORD,
      acceptTerms: true,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const access = res.body.tokens.accessToken as string;
  const session = await api().get('/v2/auth/session').set(bearer(access));
  const slug = session.body.org.slug as string;
  const row = await h.owner.query(`SELECT id FROM organizations WHERE slug = $1`, [slug]);
  return { email, slug, access, orgId: Number(row.rows[0].id) };
}

async function makePlan(body: Record<string, unknown>): Promise<PlanAdminItem> {
  const res = await ops('post', '/plans').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as PlanAdminItem;
}
const freePlan = (slug: string, extra: Record<string, unknown> = {}) =>
  makePlan({ name: slug, slug, isFree: true, ...extra });
const paidPlan = (slug: string, amount: string, extra: Record<string, unknown> = {}) =>
  makePlan({ name: slug, slug, amount, ...extra });

async function setRegistration(patch: Record<string, unknown>) {
  const res = await ops('patch', '/settings/registration').send(patch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** Moves an organization onto a plan slug (WaDesk's checkout does this; the slice has no checkout yet). */
const putOnPlan = (orgId: number, planSlug: string) =>
  h.owner.query(`UPDATE organizations SET plan = $2 WHERE id = $1`, [orgId, planSlug]);

async function stateOf(orgId: number) {
  const res = await h.owner.query(
    `SELECT o.plan, s.trial_ends_at, s.plan_ends_at, s.billing_cycle, s.overrides, s.platform_owned
       FROM organizations o JOIN org_plan_state s ON s.org_id = o.id WHERE o.id = $1`,
    [orgId],
  );
  expect(res.rows, `org_plan_state row for org ${orgId}`).toHaveLength(1);
  return res.rows[0] as {
    plan: string;
    trial_ends_at: Date | null;
    plan_ends_at: Date | null;
    billing_cycle: string;
    overrides: Record<string, unknown>;
    platform_owned: boolean;
  };
}

async function registeredEvent(orgId: number) {
  const res = await h.owner.query(
    `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'auth.user.registered'`,
    [orgId],
  );
  expect(res.rows).toHaveLength(1);
  return res.rows[0].payload as Record<string, unknown>;
}

async function planEvents(slug: string) {
  const res = await h.owner.query(
    `SELECT event, actor_type, actor_id, status, payload FROM security_events
      WHERE event LIKE 'platform.plan.%' AND payload->>'slug' = $1 ORDER BY id`,
    [slug],
  );
  return res.rows as Array<{
    event: string;
    actor_type: string;
    actor_id: number;
    status: string;
    payload: Record<string, unknown>;
  }>;
}
const countPlans = async () =>
  Number((await h.owner.query(`SELECT count(*)::int AS n FROM plans`)).rows[0].n);

const errorPaths = (body: { errors?: Array<{ path: string }> }) =>
  (body.errors ?? []).map((e) => e.path);

beforeAll(async () => {
  h = await startHarness();

  // The super admin must enrol MFA at first sign-in before the console lets them in.
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  expect(first.body).toMatchObject({ status: 'authenticated', mfaEnrolmentRequired: true });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  superToken = token;

  const supportLogin = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  expect(supportLogin.body.status).toBe('authenticated');
  supportToken = supportLogin.body.tokens.accessToken as string;

  operatorId = Number(
    (await h.owner.query(`SELECT id FROM platform_operators WHERE email = $1`, [OPERATOR_EMAIL]))
      .rows[0].id,
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

// The catalogue is platform-wide and shared by the whole file: every test starts empty, with the default policy.
beforeEach(async () => {
  await h.owner.query('DELETE FROM plans');
  await setRegistration({ defaultPlanId: null, trialDays: 14 });
});

describe('operator catalogue: create', () => {
  it('derives the slug from the name and keeps it unique: pro_plus, pro_plus_2, pro_plus_3', async () => {
    const a = await makePlan({ name: 'Pro Plus', amount: '29' });
    expect(a).toMatchObject({
      slug: 'pro_plus',
      name: 'Pro Plus',
      kind: 'paid',
      amount: '29.00',
      offerAmount: null,
      subtitle: null,
      detail: null,
      currency: 'USD',
      billingUnit: 'months',
      billingDuration: 1,
      isFree: false,
      isLifetime: false,
      isActive: true,
      isDefault: false,
      isHighlighted: false,
      isCustomQuote: false,
      sortOrder: 0,
      ctaLabel: 'Get started',
      inUse: 0,
      isRegistrationDefault: false,
    });
    expect(planAdminItemSchema.safeParse(a).success).toBe(true);

    expect((await makePlan({ name: 'Pro Plus', amount: '29' })).slug).toBe('pro_plus_2');
    expect((await makePlan({ name: 'pro plus', amount: '29' })).slug).toBe('pro_plus_3');
  });

  it('uses a requested slug (lower-cased) and still makes it unique', async () => {
    expect((await makePlan({ name: 'Whatever', slug: 'Custom_Slug', isFree: true })).slug).toBe(
      'custom_slug',
    );
    expect((await makePlan({ name: 'Other', slug: 'custom_slug', isFree: true })).slug).toBe(
      'custom_slug_2',
    );
  });

  it('never makes a bare-number slug: an all-digit name becomes "plan"', async () => {
    expect((await makePlan({ name: '2024', amount: '9' })).slug).toBe('plan');
    const rejected = await ops('post', '/plans').send({ name: 'x', slug: '12345', amount: '9' });
    expect(rejected.status).toBe(422);
    expect(errorPaths(rejected.body)).toContain('slug');
  });

  it('keeps the slug within 32 characters even with the uniqueness suffix', async () => {
    const long = `Plan ${'x'.repeat(50)}`;
    const first = await makePlan({ name: long, amount: '9' });
    const second = await makePlan({ name: long, amount: '9' });
    expect(first.slug).toBe(`plan_${'x'.repeat(27)}`);
    expect(first.slug).toHaveLength(32);
    expect(second.slug).toHaveLength(32);
    expect(second.slug.endsWith('_2')).toBe(true);
    expect(second.slug).not.toBe(first.slug);
  });

  it('stores limits and features and returns every registry key, defaulting to 0 and off', async () => {
    const plan = await makePlan({
      name: 'Rich',
      amount: '49',
      limits: { monthly_messages: 1000, devices: 2 },
      features: { analytics: true, remove_branding: true },
    });
    expect(plan.limits).toMatchObject({
      monthly_messages: 1000,
      devices: 2,
      users: 0,
      contacts: 0,
    });
    expect(plan.features).toMatchObject({
      analytics: true,
      remove_branding: true,
      automation: false,
      calling: false,
    });
    const stored = await h.owner.query(`SELECT limits, features FROM plans WHERE slug = $1`, [
      plan.slug,
    ]);
    expect(stored.rows[0].limits).toMatchObject({ monthly_messages: 1000, devices: 2 });
    expect(stored.rows[0].features).toMatchObject({ analytics: true, remove_branding: true });
  });

  it('normalises money and treats an offer of 0 as no offer', async () => {
    const a = await makePlan({ name: 'Money', amount: '19.5', offerAmount: '0' });
    expect(a).toMatchObject({ amount: '19.50', offerAmount: null });
    const b = await makePlan({ name: 'Money', amount: '20', offerAmount: '14' });
    expect(b).toMatchObject({ amount: '20.00', offerAmount: '14.00' });
    const free = await makePlan({ name: 'Free', isFree: true, offerAmount: '0', subtitle: '   ' });
    expect(free).toMatchObject({ kind: 'free', amount: '0.00', offerAmount: null, subtitle: null });
  });

  it('classifies free, paid and custom-quote plans', async () => {
    expect((await makePlan({ name: 'F', isFree: true })).kind).toBe('free');
    expect((await makePlan({ name: 'P', amount: '5' })).kind).toBe('paid');
    expect((await makePlan({ name: 'Q', isCustomQuote: true })).kind).toBe('custom_quote');
  });

  describe('refuses an invalid plan with a 422 and errors[] per field, storing nothing', () => {
    const cases: Array<[string, Record<string, unknown>, string[]]> = [
      [
        'an offer equal to the price',
        { name: 'X', amount: '10', offerAmount: '10' },
        ['offerAmount'],
      ],
      ['an offer above the price', { name: 'X', amount: '10', offerAmount: '12' }, ['offerAmount']],
      ['a free plan with a price', { name: 'X', isFree: true, amount: '5' }, ['amount']],
      ['a free plan with an offer', { name: 'X', isFree: true, offerAmount: '2' }, ['offerAmount']],
      ['a price of 0 not marked free', { name: 'X', amount: '0' }, ['amount']],
      ['no price at all and not free', { name: 'X' }, ['amount']],
      ['a custom quote with a price', { name: 'X', isCustomQuote: true, amount: '9' }, ['amount']],
      [
        'a custom quote that is also free',
        { name: 'X', isCustomQuote: true, isFree: true },
        ['isFree'],
      ],
      [
        'an inactive default',
        { name: 'X', isFree: true, isDefault: true, isActive: false },
        ['isDefault'],
      ],
      ['a bad amount', { name: 'X', amount: 'abc' }, ['amount']],
      ['too many decimals', { name: 'X', amount: '1.999' }, ['amount']],
      ['an empty name', { name: '', amount: '9' }, ['name']],
      ['a missing name', { amount: '9' }, ['name']],
      ['a bare-number slug', { name: 'X', slug: '12345', amount: '9' }, ['slug']],
      ['a 33-character slug', { name: 'X', slug: 'a'.repeat(33), amount: '9' }, ['slug']],
      ['a slug with a space', { name: 'X', slug: 'a b', amount: '9' }, ['slug']],
      ['a bad currency', { name: 'X', amount: '9', currency: 'DOLLARS' }, ['currency']],
      [
        'a zero billing duration',
        { name: 'X', amount: '9', billingDuration: 0 },
        ['billingDuration'],
      ],
      ['a negative limit', { name: 'X', amount: '9', limits: { devices: -1 } }, ['limits.devices']],
      [
        'a non-boolean feature',
        { name: 'X', amount: '9', features: { calling: 'yes' } },
        ['features.calling'],
      ],
    ];
    for (const [label, body, paths] of cases) {
      it(label, async () => {
        const res = await ops('post', '/plans').send(body);
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        for (const p of paths)
          expect(errorPaths(res.body), JSON.stringify(res.body.errors)).toContain(p);
        for (const e of res.body.errors) expect(e.message).toBeTruthy();
        expect(await countPlans()).toBe(0);
      });
    }

    it('reports every broken rule at once', async () => {
      const res = await ops('post', '/plans').send({
        name: 'X',
        isFree: true,
        amount: '5',
        offerAmount: '3',
        isDefault: true,
        isActive: false,
      });
      expect(res.status).toBe(422);
      expect(errorPaths(res.body).sort()).toEqual(['amount', 'isDefault', 'offerAmount']);
    });
  });
});

describe('operator catalogue: read', () => {
  it('lists every plan, inactive ones too, in sort order then price, with the KPI summary and in-use counts', async () => {
    await freePlan('free_a', { sortOrder: 1 });
    await paidPlan('paid_dear', '29', { sortOrder: 3 });
    await paidPlan('paid_cheap', '9', { sortOrder: 3 });
    await paidPlan('paid_off', '5', { sortOrder: 0, isActive: false });
    await makePlan({ name: 'Enterprise', slug: 'enterprise_a', isCustomQuote: true, sortOrder: 5 });

    const res = await ops('get', '/plans');
    expect(res.status).toBe(200);
    expect(planAdminListResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.data.map((p: PlanAdminItem) => p.slug)).toEqual([
      'paid_off',
      'free_a',
      'paid_cheap',
      'paid_dear',
      'enterprise_a',
    ]);
    expect(res.body.summary).toEqual({ total: 5, active: 4, free: 1, paid: 3, customQuote: 1 });
    expect(res.body.registrationDefaultSlug).toBeNull();
    expect(res.body.data.every((p: PlanAdminItem) => p.inUse === 0)).toBe(true);
  });

  it('returns one plan by id, 404 for an unknown id and 422 for a malformed one', async () => {
    const plan = await paidPlan(slugOf('one'), '12');
    const got = await ops('get', `/plans/${plan.id}`);
    expect(got.status).toBe(200);
    expect(got.body).toEqual(plan);

    const missing = await ops('get', '/plans/00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('NOT_FOUND');
    expect((await ops('get', '/plans/not-a-uuid')).status).toBe(422);
  });

  it('exposes only uuids: the internal id never leaves the system', async () => {
    const plan = await paidPlan(slugOf('uuid'), '12');
    expect(plan.id).toMatch(/^[0-9a-f-]{36}$/);
    const list = await ops('get', '/plans');
    expect(JSON.stringify(list.body)).not.toMatch(/"id":\d+/);
  });

  it('counts an add-on out: operator endpoints only ever see plans', async () => {
    await h.owner.query(
      `INSERT INTO plans (slug, name, kind, is_free) VALUES ('addon_x', 'Addon', 'addon', true)`,
    );
    const list = await ops('get', '/plans');
    expect(list.body.data).toEqual([]);
    expect(list.body.summary.total).toBe(0);
  });
});

describe('operator catalogue: roles', () => {
  it('lets the support operator read, and refuses every write with AUTH_OPERATOR_ROLE_REQUIRED', async () => {
    const plan = await paidPlan(slugOf('support'), '12');
    expect((await support('get', '/plans')).status).toBe(200);
    const one = await support('get', `/plans/${plan.id}`);
    expect(one.status).toBe(200);
    expect(one.body.slug).toBe(plan.slug);

    // Thunks, not started requests: supertest closes its ephemeral server after each one.
    const attempts = [
      () => support('post', '/plans').send({ name: 'Nope', amount: '9' }),
      () => support('patch', `/plans/${plan.id}`).send({ name: 'Renamed' }),
      () => support('patch', `/plans/${plan.id}/active`).send({ isActive: false }),
      () => support('delete', `/plans/${plan.id}`),
    ];
    for (const attempt of attempts) {
      const res = await attempt();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AUTH_OPERATOR_ROLE_REQUIRED');
    }
    // Nothing changed and nothing was audited as a plan event.
    const after = await ops('get', `/plans/${plan.id}`);
    expect(after.body).toEqual(plan);
    expect(await countPlans()).toBe(1);
    expect((await planEvents(plan.slug)).map((e) => e.event)).toEqual(['platform.plan.created']);
  });

  it('keeps tenant and anonymous callers out of the platform endpoints', async () => {
    const a = await signup();
    const plan = await paidPlan(slugOf('guarded'), '12');
    for (const [method, path, body] of [
      ['get', '/plans', undefined],
      ['get', `/plans/${plan.id}`, undefined],
      ['post', '/plans', { name: 'Nope', amount: '9' }],
      ['patch', `/plans/${plan.id}`, { name: 'Nope' }],
      ['patch', `/plans/${plan.id}/active`, { isActive: false }],
      ['delete', `/plans/${plan.id}`, undefined],
    ] as const) {
      const tenant = await api()
        [method](`/v2/platform${path}`)
        .set(bearer(a.access))
        .send(body as object | undefined);
      expect([401, 403], `${method} ${path} as a tenant`).toContain(tenant.status);
      const anon = await api()
        [method](`/v2/platform${path}`)
        .send(body as object | undefined);
      expect(anon.status, `${method} ${path} anonymously`).toBe(401);
    }
    expect(await countPlans()).toBe(1);
  });

  it('keeps operators out of the tenant plan list', async () => {
    const res = await api().get('/v2/plans').set(bearer(superToken));
    expect([401, 403]).toContain(res.status);
    expect((await api().get('/v2/plans')).status).toBe(401);
  });
});

describe('operator catalogue: update', () => {
  it('applies a partial patch, keeps the slug, and merges limits and features key by key', async () => {
    const plan = await makePlan({
      name: 'Patchable',
      slug: slugOf('patch'),
      amount: '29',
      offerAmount: '19',
      subtitle: 'Old subtitle',
      limits: { monthly_messages: 1000 },
      features: { analytics: true },
    });
    const res = await ops('patch', `/plans/${plan.id}`).send({
      name: '  Renamed ',
      amount: '39',
      slug: 'hijacked',
      limits: { devices: 5 },
      features: { calling: true },
      subtitle: '',
      offerAmount: null,
      sortOrder: 7,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      id: plan.id,
      slug: plan.slug,
      name: 'Renamed',
      amount: '39.00',
      offerAmount: null,
      subtitle: null,
      sortOrder: 7,
    });
    expect(res.body.limits).toMatchObject({ monthly_messages: 1000, devices: 5 });
    expect(res.body.features).toMatchObject({ analytics: true, calling: true });

    const stored = await h.owner.query(`SELECT slug, name FROM plans WHERE uuid = $1`, [plan.id]);
    expect(stored.rows).toEqual([{ slug: plan.slug, name: 'Renamed' }]);
    expect((await h.owner.query(`SELECT 1 FROM plans WHERE slug = 'hijacked'`)).rows).toHaveLength(
      0,
    );
  });

  it('an empty patch changes nothing', async () => {
    const plan = await paidPlan(slugOf('empty'), '12');
    const res = await ops('patch', `/plans/${plan.id}`).send({});
    expect(res.status).toBe(200);
    // Every field is as it was (the row's update stamp aside) and nothing was audited.
    expect({ ...res.body, updatedAt: null }).toEqual({ ...plan, updatedAt: null });
    expect((await planEvents(plan.slug)).map((e) => e.event)).toEqual(['platform.plan.created']);
  });

  it('re-checks the rules on the merged plan: a patch that makes the stored plan inconsistent is refused', async () => {
    const plan = await paidPlan(slugOf('merge'), '29', { offerAmount: '19' });
    const refused: Array<[string, Record<string, unknown>, string]> = [
      ['marking a priced plan free', { isFree: true }, 'amount'],
      ['an offer not below the price', { offerAmount: '29' }, 'offerAmount'],
      ['lowering the price under the offer', { amount: '18' }, 'offerAmount'],
      ['a price of 0 without the free flag', { amount: '0', offerAmount: null }, 'amount'],
      ['making a priced plan a custom quote', { isCustomQuote: true }, 'amount'],
      ['a default that is inactive', { isDefault: true, isActive: false }, 'isDefault'],
      ['a bad amount', { amount: 'abc' }, 'amount'],
    ];
    for (const [label, body, path] of refused) {
      const res = await ops('patch', `/plans/${plan.id}`).send(body);
      expect(res.status, label).toBe(422);
      expect(res.body.code, label).toBe('VALIDATION_FAILED');
      expect(errorPaths(res.body), label).toContain(path);
    }
    expect((await ops('get', `/plans/${plan.id}`)).body).toEqual(plan);

    // The consistent way to the same end is accepted.
    const ok = await ops('patch', `/plans/${plan.id}`).send({
      isFree: true,
      amount: '0',
      offerAmount: null,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ kind: 'free', amount: '0.00', offerAmount: null });
  });

  it('answers 404 for an unknown plan and 422 for a malformed id', async () => {
    const missing = await ops('patch', '/plans/00000000-0000-4000-8000-000000000000').send({
      name: 'x',
    });
    expect(missing.status).toBe(404);
    expect((await ops('patch', '/plans/nope').send({ name: 'x' })).status).toBe(422);
  });

  it('flips active with its own endpoint, which wants a boolean', async () => {
    const plan = await paidPlan(slugOf('toggle'), '12');
    const off = await ops('patch', `/plans/${plan.id}/active`).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    const on = await ops('patch', `/plans/${plan.id}/active`).send({ isActive: true });
    expect(on.body.isActive).toBe(true);
    for (const bad of [{}, { isActive: 'no' }, { isActive: null }]) {
      expect((await ops('patch', `/plans/${plan.id}/active`).send(bad)).status).toBe(422);
    }
    expect(
      (
        await ops('patch', '/plans/00000000-0000-4000-8000-000000000000/active').send({
          isActive: false,
        })
      ).status,
    ).toBe(404);
  });
});

describe('operator catalogue: the default plan', () => {
  const defaultsInDb = async () =>
    (await h.owner.query(`SELECT slug FROM plans WHERE is_default ORDER BY slug`)).rows.map(
      (r) => r.slug,
    );

  it('flagging a plan default clears the previous default, on create and on update', async () => {
    const a = await freePlan(slugOf('def_a'), { isDefault: true });
    expect(await defaultsInDb()).toEqual([a.slug]);
    const b = await freePlan(slugOf('def_b'), { isDefault: true });
    expect(await defaultsInDb()).toEqual([b.slug]);
    expect((await ops('get', `/plans/${a.id}`)).body.isDefault).toBe(false);

    const back = await ops('patch', `/plans/${a.id}`).send({ isDefault: true });
    expect(back.status).toBe(200);
    expect(await defaultsInDb()).toEqual([a.slug]);
    expect((await ops('get', `/plans/${b.id}`)).body.isDefault).toBe(false);
  });

  it('refuses to deactivate or delete the flagged default with 409 PLAN_DEFAULT_PROTECTED', async () => {
    const def = await freePlan(slugOf('def'), { isDefault: true });

    const deactivate = await ops('patch', `/plans/${def.id}/active`).send({ isActive: false });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body.code).toBe('PLAN_DEFAULT_PROTECTED');
    expect(deactivate.body.errors).toEqual([{ path: 'slug', message: def.slug }]);

    // Un-flagging and deactivating in one patch is still deactivating the default.
    const sneaky = await ops('patch', `/plans/${def.id}`).send({
      isDefault: false,
      isActive: false,
    });
    expect(sneaky.status).toBe(409);
    expect(sneaky.body.code).toBe('PLAN_DEFAULT_PROTECTED');

    // Deactivating it while it stays the default is an invalid plan (the default must be active).
    const invalid = await ops('patch', `/plans/${def.id}`).send({ isActive: false });
    expect(invalid.status).toBe(422);
    expect(errorPaths(invalid.body)).toContain('isDefault');

    const remove = await ops('delete', `/plans/${def.id}`);
    expect(remove.status).toBe(409);
    expect(remove.body.code).toBe('PLAN_DEFAULT_PROTECTED');

    const still = await ops('get', `/plans/${def.id}`);
    expect(still.body).toMatchObject({ isActive: true, isDefault: true });
  });

  it('lets the flag move first: once another plan is the default, the old one can go', async () => {
    const old = await freePlan(slugOf('old_def'), { isDefault: true });
    await freePlan(slugOf('new_def'), { isDefault: true });
    expect((await ops('patch', `/plans/${old.id}/active`).send({ isActive: false })).status).toBe(
      200,
    );
    expect((await ops('delete', `/plans/${old.id}`)).status).toBe(200);
  });

  it('un-flagging the default is allowed and frees it for deactivation', async () => {
    const def = await freePlan(slugOf('unflag'), { isDefault: true });
    expect((await ops('patch', `/plans/${def.id}`).send({ isDefault: false })).status).toBe(200);
    expect(await defaultsInDb()).toEqual([]);
    expect((await ops('patch', `/plans/${def.id}/active`).send({ isActive: false })).status).toBe(
      200,
    );
  });

  it('protects the plan named by the registration setting too, and shows it in the list', async () => {
    const named = await paidPlan(slugOf('named'), '29');
    const other = await paidPlan(slugOf('other'), '39');
    await setRegistration({ defaultPlanId: named.slug });

    const list = await ops('get', '/plans');
    expect(list.body.registrationDefaultSlug).toBe(named.slug);
    expect(
      list.body.data.find((p: PlanAdminItem) => p.slug === named.slug).isRegistrationDefault,
    ).toBe(true);
    expect(
      list.body.data.find((p: PlanAdminItem) => p.slug === other.slug).isRegistrationDefault,
    ).toBe(false);
    expect((await ops('get', `/plans/${named.id}`)).body.isRegistrationDefault).toBe(true);

    for (const res of [
      await ops('patch', `/plans/${named.id}/active`).send({ isActive: false }),
      await ops('patch', `/plans/${named.id}`).send({ isActive: false }),
      await ops('delete', `/plans/${named.id}`),
    ]) {
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.code).toBe('PLAN_DEFAULT_PROTECTED');
    }
    // A different plan is free to go.
    expect((await ops('delete', `/plans/${other.id}`)).status).toBe(200);

    // Clearing the setting releases the protection.
    await setRegistration({ defaultPlanId: null });
    expect((await ops('patch', `/plans/${named.id}/active`).send({ isActive: false })).status).toBe(
      200,
    );
    expect((await ops('delete', `/plans/${named.id}`)).status).toBe(200);
  });
});

describe('operator catalogue: delete and the in-use guard', () => {
  it('refuses to delete a plan any organization is on (409 PLAN_IN_USE, errors[] carries the count) and allows it once they leave', async () => {
    const plan = await paidPlan(slugOf('busy'), '29');
    const spare = await paidPlan(slugOf('spare'), '39');
    const a = await signup();
    const b = await signup();
    await putOnPlan(a.orgId, plan.slug);

    const one = await ops('delete', `/plans/${plan.id}`);
    expect(one.status).toBe(409);
    expect(one.body.code).toBe('PLAN_IN_USE');
    expect(one.body.errors).toEqual([{ path: 'inUse', message: '1' }]);
    expect(one.body.detail).toMatch(/1 workspace/);

    await putOnPlan(b.orgId, plan.slug);
    const two = await ops('delete', `/plans/${plan.id}`);
    expect(two.status).toBe(409);
    expect(two.body.errors).toEqual([{ path: 'inUse', message: '2' }]);

    // The list and the single read agree on the count.
    const list = await ops('get', '/plans');
    expect(list.body.data.find((p: PlanAdminItem) => p.slug === plan.slug).inUse).toBe(2);
    expect(list.body.data.find((p: PlanAdminItem) => p.slug === spare.slug).inUse).toBe(0);
    expect((await ops('get', `/plans/${plan.id}`)).body.inUse).toBe(2);
    expect(await countPlans()).toBe(2);

    // Deactivating an in-use plan is allowed (it just stops being offered).
    expect((await ops('patch', `/plans/${plan.id}/active`).send({ isActive: false })).status).toBe(
      200,
    );

    await putOnPlan(a.orgId, spare.slug);
    await putOnPlan(b.orgId, spare.slug);
    const gone = await ops('delete', `/plans/${plan.id}`);
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect(gone.body).toEqual({ ok: true });
    expect((await ops('get', `/plans/${plan.id}`)).status).toBe(404);
    expect((await ops('get', `/plans/${spare.id}`)).body.inUse).toBe(2);
  });

  it('deletes an unused plan, and a second delete is a 404', async () => {
    const plan = await paidPlan(slugOf('unused'), '12');
    expect((await ops('delete', `/plans/${plan.id}`)).status).toBe(200);
    expect((await ops('delete', `/plans/${plan.id}`)).status).toBe(404);
    expect((await ops('delete', '/plans/nope')).status).toBe(422);
  });

  it('counts a sign-up that landed on the plan as in use', async () => {
    // Not flagged and not named by the setting: the sign-up resolver picks it as the first free plan.
    const plan = await freePlan(slugOf('landed'));
    const a = await signup();
    expect((await stateOf(a.orgId)).plan).toBe(plan.slug);
    expect((await ops('get', `/plans/${plan.id}`)).body.inUse).toBe(1);
    const res = await ops('delete', `/plans/${plan.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_IN_USE');
    expect(res.body.errors).toEqual([{ path: 'inUse', message: '1' }]);
  });

  it('a protected default that is also in use is refused either way, never deleted', async () => {
    const plan = await freePlan(slugOf('landed_default'), { isDefault: true });
    await signup();
    const res = await ops('delete', `/plans/${plan.id}`);
    expect(res.status).toBe(409);
    expect(['PLAN_DEFAULT_PROTECTED', 'PLAN_IN_USE']).toContain(res.body.code);
    expect(await countPlans()).toBe(1);
  });
});

describe('operator catalogue: audit', () => {
  it('writes a security_events row for every successful write, by the operator, with the slug', async () => {
    const plan = await makePlan({ name: 'Audited', slug: slugOf('audited'), amount: '29' });
    const updated = await ops('patch', `/plans/${plan.id}`).send({
      amount: '39',
      name: 'Audited 2',
    });
    expect(updated.status).toBe(200);
    expect((await ops('patch', `/plans/${plan.id}/active`).send({ isActive: false })).status).toBe(
      200,
    );
    expect((await ops('patch', `/plans/${plan.id}/active`).send({ isActive: true })).status).toBe(
      200,
    );
    expect((await ops('patch', `/plans/${plan.id}/active`).send({ isActive: false })).status).toBe(
      200,
    );
    expect((await ops('delete', `/plans/${plan.id}`)).status).toBe(200);

    const events = await planEvents(plan.slug);
    expect(events.map((e) => e.event)).toEqual([
      'platform.plan.created',
      'platform.plan.updated',
      'platform.plan.deactivated',
      'platform.plan.activated',
      'platform.plan.deactivated',
      'platform.plan.deleted',
    ]);
    for (const e of events) {
      expect(e.actor_type).toBe('platform_operator');
      expect(Number(e.actor_id)).toBe(operatorId);
      expect(e.status).toBe('info');
      expect(e.payload.slug).toBe(plan.slug);
    }
    expect(events[0]!.payload).toMatchObject({
      name: 'Audited',
      kind: 'paid',
      amount: '29.00',
      currency: 'USD',
      isActive: true,
      isDefault: false,
    });
    expect(events[1]!.payload.fields).toEqual(expect.arrayContaining(['name', 'amount']));
    expect(events[1]!.payload.changes).toMatchObject({
      amount: { from: '29.00', to: '39.00' },
      name: { from: 'Audited', to: 'Audited 2' },
    });
    expect(events[5]!.payload).toMatchObject({ name: 'Audited 2' });
  });

  it('writes nothing for a no-op update or a no-op activation', async () => {
    const plan = await paidPlan(slugOf('noop'), '12');
    await ops('patch', `/plans/${plan.id}`).send({ amount: '12.00', name: plan.name });
    await ops('patch', `/plans/${plan.id}/active`).send({ isActive: true });
    expect((await planEvents(plan.slug)).map((e) => e.event)).toEqual(['platform.plan.created']);
  });

  it('writes nothing for a refused write', async () => {
    const plan = await freePlan(slugOf('refused'), { isDefault: true });
    await ops('patch', `/plans/${plan.id}`).send({ isFree: false });
    await ops('patch', `/plans/${plan.id}/active`).send({ isActive: false });
    await ops('delete', `/plans/${plan.id}`);
    expect((await planEvents(plan.slug)).map((e) => e.event)).toEqual(['platform.plan.created']);
  });
});

describe('registration default plan', () => {
  it('must name an existing, active plan: 422 with errors[] on defaultPlanId otherwise', async () => {
    const unknown = await ops('patch', '/settings/registration').send({ defaultPlanId: 'ghost' });
    expect(unknown.status).toBe(422);
    expect(unknown.body.errors).toEqual([
      { path: 'defaultPlanId', message: expect.stringMatching(/active plan/i) },
    ]);

    const retired = await paidPlan(slugOf('retired'), '9', { isActive: false });
    const inactive = await ops('patch', '/settings/registration').send({
      defaultPlanId: retired.slug,
    });
    expect(inactive.status).toBe(422);
    expect(errorPaths(inactive.body)).toEqual(['defaultPlanId']);

    await h.owner.query(
      `INSERT INTO plans (slug, name, kind, is_free) VALUES ('addon_y', 'Add-on', 'addon', true)`,
    );
    const addon = await ops('patch', '/settings/registration').send({ defaultPlanId: 'addon_y' });
    expect(addon.status).toBe(422);

    // The refused values were not stored.
    const cfg = await ops('get', '/settings/registration');
    expect(cfg.body.defaultPlanId).toBeNull();
  });

  it('accepts an active plan, shows it back, and accepts null to clear it', async () => {
    const plan = await paidPlan(slugOf('registered'), '9');
    const set = await ops('patch', '/settings/registration').send({ defaultPlanId: plan.slug });
    expect(set.status).toBe(200);
    expect(set.body.defaultPlanId).toBe(plan.slug);
    expect((await ops('get', '/settings/registration')).body.defaultPlanId).toBe(plan.slug);

    const cleared = await ops('patch', '/settings/registration').send({ defaultPlanId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.defaultPlanId).toBeNull();
  });

  it('does not validate the plan when the patch leaves it alone', async () => {
    const plan = await paidPlan(slugOf('left_alone'), '9');
    await setRegistration({ defaultPlanId: plan.slug });
    // The plan disappears behind the setting's back (an owner-level delete); an unrelated patch still works.
    await h.owner.query(`DELETE FROM plans WHERE slug = $1`, [plan.slug]);
    const res = await ops('patch', '/settings/registration').send({ trialDays: 21 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ trialDays: 21, defaultPlanId: plan.slug });
  });
});

describe('sign-up plan assignment', () => {
  it('a free default plan with a trial length: the org gets that plan, a trial ending in trialDays, and the outbox says so', async () => {
    const free = await freePlan(slugOf('free_default'), { isDefault: true });
    await setRegistration({ trialDays: 14 });

    const t0 = Date.now();
    const a = await signup();
    const t1 = Date.now();

    const state = await stateOf(a.orgId);
    expect(state.plan).toBe(free.slug);
    expect(state.billing_cycle).toBe('trial');
    const ends = state.trial_ends_at!.getTime();
    expect(ends).toBeGreaterThanOrEqual(t0 + 14 * DAY);
    expect(ends).toBeLessThanOrEqual(t1 + 14 * DAY);
    expect(state).toMatchObject({ plan_ends_at: null, platform_owned: false, overrides: {} });

    const evt = await registeredEvent(a.orgId);
    expect(evt).toMatchObject({
      planSlug: free.slug,
      trialDays: 14,
      defaultPlanId: null,
      email: a.email,
    });
    expect(new Date(evt.trialEndsAt as string).getTime()).toBe(ends);

    const audit = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'auth.signup' AND org_id = $1`,
      [a.orgId],
    );
    expect(audit.rows[0].payload).toMatchObject({ plan: free.slug, trial: true });

    const session = await api().get('/v2/auth/session').set(bearer(a.access));
    expect(session.body.org.plan).toBe(free.slug);
    const plans = await api().get('/v2/plans').set(bearer(a.access));
    expect(plans.body.currentSlug).toBe(free.slug);
    expect(plans.body.trialEndsAt).toBe(new Date(ends).toISOString());
  });

  it('the registration setting beats the flagged default', async () => {
    await freePlan(slugOf('flagged'), { isDefault: true });
    const chosen = await freePlan(slugOf('chosen'));
    await setRegistration({ defaultPlanId: chosen.slug, trialDays: 7 });
    const a = await signup();
    expect((await stateOf(a.orgId)).plan).toBe(chosen.slug);
    expect(await registeredEvent(a.orgId)).toMatchObject({
      planSlug: chosen.slug,
      defaultPlanId: chosen.slug,
      trialDays: 7,
    });
  });

  it('a registration plan that was deactivated meanwhile falls through to the flagged default', async () => {
    const flagged = await freePlan(slugOf('flagged'), { isDefault: true });
    const chosen = await paidPlan(slugOf('chosen'), '29');
    await setRegistration({ defaultPlanId: chosen.slug });
    // The API refuses to deactivate it; an operator with database access can.
    await h.owner.query(`UPDATE plans SET is_active = false WHERE slug = $1`, [chosen.slug]);
    const a = await signup();
    expect((await stateOf(a.orgId)).plan).toBe(flagged.slug);
  });

  it('with no setting and no flagged default, the first free plan by sort order', async () => {
    await paidPlan(slugOf('paid_first'), '9', { sortOrder: 0 });
    await freePlan(slugOf('free_late'), { sortOrder: 5 });
    const early = await freePlan(slugOf('free_early'), { sortOrder: 2 });
    const a = await signup();
    expect((await stateOf(a.orgId)).plan).toBe(early.slug);
  });

  it('a paid default: that plan, no trial, billing cycle monthly, trialEndsAt null in the outbox', async () => {
    const paid = await paidPlan(slugOf('paid_default'), '29');
    await setRegistration({ defaultPlanId: paid.slug, trialDays: 14 });
    const a = await signup();

    const state = await stateOf(a.orgId);
    expect(state).toMatchObject({ plan: paid.slug, trial_ends_at: null, billing_cycle: 'monthly' });
    expect(await registeredEvent(a.orgId)).toMatchObject({
      planSlug: paid.slug,
      trialEndsAt: null,
    });
    const plans = await api().get('/v2/plans').set(bearer(a.access));
    expect(plans.body.trialEndsAt).toBeNull();
    const audit = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'auth.signup' AND org_id = $1`,
      [a.orgId],
    );
    expect(audit.rows[0].payload).toMatchObject({ plan: paid.slug, trial: false });
  });

  it('a flagged paid default also gets no trial', async () => {
    const paid = await paidPlan(slugOf('flagged_paid'), '29', { isDefault: true });
    await freePlan(slugOf('free_other'));
    const a = await signup();
    expect(await stateOf(a.orgId)).toMatchObject({
      plan: paid.slug,
      trial_ends_at: null,
      billing_cycle: 'monthly',
    });
  });

  it('a free plan with trialDays 0: no trial, monthly', async () => {
    const free = await freePlan(slugOf('no_trial'), { isDefault: true });
    await setRegistration({ trialDays: 0 });
    const a = await signup();
    expect(await stateOf(a.orgId)).toMatchObject({
      plan: free.slug,
      trial_ends_at: null,
      billing_cycle: 'monthly',
    });
    expect(await registeredEvent(a.orgId)).toMatchObject({
      planSlug: free.slug,
      trialEndsAt: null,
      trialDays: 0,
    });
  });

  it('a custom-quote plan is not free: even when it is the setting, no trial', async () => {
    const quote = await makePlan({ name: 'Quote', slug: slugOf('quote'), isCustomQuote: true });
    await setRegistration({ defaultPlanId: quote.slug, trialDays: 14 });
    const a = await signup();
    expect(await stateOf(a.orgId)).toMatchObject({
      plan: quote.slug,
      trial_ends_at: null,
      billing_cycle: 'monthly',
    });
  });

  it('only paid plans and no default: the literal starter, no trial', async () => {
    await paidPlan(slugOf('only_paid'), '29');
    const a = await signup();
    expect(await stateOf(a.orgId)).toMatchObject({
      plan: 'starter',
      trial_ends_at: null,
      billing_cycle: 'monthly',
    });
    expect(await registeredEvent(a.orgId)).toMatchObject({
      planSlug: 'starter',
      trialEndsAt: null,
    });
  });

  it('no plans at all: the literal starter with no trial, and nothing is locked', async () => {
    expect(await countPlans()).toBe(0);
    const a = await signup();
    expect(await stateOf(a.orgId)).toMatchObject({
      plan: 'starter',
      trial_ends_at: null,
      billing_cycle: 'monthly',
    });
    expect((await registeredEvent(a.orgId)).planSlug).toBe('starter');
    expect(await countPlans()).toBe(0);

    const get = await api().get('/v2/account/branding').set(bearer(a.access));
    expect(get.body.canEdit).toBe(true);
    const patch = await api()
      .patch('/v2/account/branding')
      .set(bearer(a.access))
      .send({ messageFooter: 'Sent by us' });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.messageFooter).toBe('Sent by us');
  });

  it('gives every sign-up its own state row', async () => {
    await freePlan(slugOf('shared'), { isDefault: true });
    const a = await signup();
    const b = await signup();
    expect(a.orgId).not.toBe(b.orgId);
    const rows = await h.owner.query(`SELECT org_id FROM org_plan_state WHERE org_id IN ($1, $2)`, [
      a.orgId,
      b.orgId,
    ]);
    expect(rows.rows).toHaveLength(2);
  });
});

describe('branding gate (feature remove_branding)', () => {
  async function orgOn(planSlug: string): Promise<Account> {
    const a = await signup();
    await putOnPlan(a.orgId, planSlug);
    return a;
  }
  const patchFooter = (a: Account, footer: string | null) =>
    api().patch('/v2/account/branding').set(bearer(a.access)).send({ messageFooter: footer });
  const getBranding = (a: Account) => api().get('/v2/account/branding').set(bearer(a.access));
  const footerEvents = async (orgId: number) =>
    Number(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'org.branding_footer.changed'`,
          [orgId],
        )
      ).rows[0].n,
    );

  it('refuses a plan without the feature: 422 PLAN_FEATURE_LOCKED with feature, reason and upgradeUrl; GET says canEdit false', async () => {
    const locked = await freePlan(slugOf('locked'), { features: { remove_branding: false } });
    const a = await orgOn(locked.slug);

    const get = await getBranding(a);
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({ messageFooter: null, canEdit: false });

    const res = await patchFooter(a, 'Sent by Acme');
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    expect(res.body.errors).toEqual([
      { path: 'feature', message: 'remove_branding' },
      { path: 'reason', message: 'feature_disabled' },
      { path: 'upgradeUrl', message: '/account/plans' },
    ]);
    expect(readPlanLock(res.body.errors)).toEqual({
      reason: 'feature_disabled',
      key: 'remove_branding',
      upgradeUrl: '/account/plans',
      used: null,
      limit: null,
    });
    expect(res.body.detail).toMatch(/plan/i);

    // Clearing the footer is gated the same way; nothing was written or announced.
    expect((await patchFooter(a, null)).status).toBe(422);
    expect((await getBranding(a)).body.messageFooter).toBeNull();
    expect(await footerEvents(a.orgId)).toBe(0);
  });

  it('a plan that has the feature lets the workspace edit the footer', async () => {
    const branded = await paidPlan(slugOf('branded'), '49', {
      features: { remove_branding: true },
    });
    const a = await orgOn(branded.slug);

    expect((await getBranding(a)).body.canEdit).toBe(true);
    const set = await patchFooter(a, 'Sent by Acme');
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toMatchObject({ messageFooter: 'Sent by Acme', canEdit: true });
    expect(await footerEvents(a.orgId)).toBe(1);
    expect((await patchFooter(a, null)).body.messageFooter).toBeNull();
    expect(await footerEvents(a.orgId)).toBe(2);
  });

  it('a plan row that predates the key (no remove_branding stored) is locked, per the registry default', async () => {
    const old = await freePlan(slugOf('predates'));
    await h.owner.query(`UPDATE plans SET features = '{}'::jsonb WHERE slug = $1`, [old.slug]);
    const a = await orgOn(old.slug);
    expect((await getBranding(a)).body.canEdit).toBe(false);
    expect((await patchFooter(a, 'x')).status).toBe(422);
  });

  it('a per-organization feature override unlocks a plan without the feature, and can lock one that has it', async () => {
    const locked = await freePlan(slugOf('locked'));
    const branded = await paidPlan(slugOf('branded'), '49', {
      features: { remove_branding: true },
    });

    const unlocked = await orgOn(locked.slug);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"remove_branding":true}}'::jsonb WHERE org_id = $1`,
      [unlocked.orgId],
    );
    expect((await getBranding(unlocked)).body.canEdit).toBe(true);
    expect((await patchFooter(unlocked, 'Override on')).status).toBe(200);

    const blocked = await orgOn(branded.slug);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"remove_branding":false}}'::jsonb WHERE org_id = $1`,
      [blocked.orgId],
    );
    expect((await getBranding(blocked)).body.canEdit).toBe(false);
    expect((await patchFooter(blocked, 'Override off')).status).toBe(422);
  });

  it('a platform-owned organization is never locked', async () => {
    const locked = await freePlan(slugOf('locked'));
    const a = await orgOn(locked.slug);
    expect((await patchFooter(a, 'before')).status).toBe(422);
    await h.owner.query(`UPDATE org_plan_state SET platform_owned = true WHERE org_id = $1`, [
      a.orgId,
    ]);
    expect((await getBranding(a)).body.canEdit).toBe(true);
    expect((await patchFooter(a, 'owned')).status).toBe(200);
    // ...even against an explicit override saying no.
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"remove_branding":false}}'::jsonb WHERE org_id = $1`,
      [a.orgId],
    );
    expect((await patchFooter(a, 'still owned')).status).toBe(200);
  });

  it('an organization whose plan has no catalogue row has every feature (nothing to lock against)', async () => {
    const a = await orgOn('ghost_plan');
    expect((await getBranding(a)).body.canEdit).toBe(true);
    expect((await patchFooter(a, 'open')).status).toBe(200);
  });

  it('follows the catalogue live: the operator turning the feature on or deleting the plan changes the answer at once', async () => {
    const plan = await freePlan(slugOf('live'));
    const a = await orgOn(plan.slug);
    expect((await patchFooter(a, 'x')).status).toBe(422);

    const enable = await ops('patch', `/plans/${plan.id}`).send({
      features: { remove_branding: true },
    });
    expect(enable.status).toBe(200);
    expect((await patchFooter(a, 'now allowed')).status).toBe(200);

    const disable = await ops('patch', `/plans/${plan.id}`).send({
      features: { remove_branding: false },
    });
    expect(disable.status).toBe(200);
    expect((await patchFooter(a, 'locked again')).status).toBe(422);

    // Deactivating hides the plan from buyers; the organization already on it keeps its entitlements.
    expect((await ops('patch', `/plans/${plan.id}/active`).send({ isActive: false })).status).toBe(
      200,
    );
    expect((await patchFooter(a, 'still locked')).status).toBe(422);

    // Removing the plan row (after moving no-one: an owner-level delete) leaves the slug unknown, so nothing is locked.
    await h.owner.query(`DELETE FROM plans WHERE slug = $1`, [plan.slug]);
    expect((await patchFooter(a, 'plan gone')).status).toBe(200);
  });

  it('is not bypassed by a limit-style value: only a true boolean grants the feature', async () => {
    const locked = await freePlan(slugOf('strict'));
    const a = await orgOn(locked.slug);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"remove_branding":"true"}}'::jsonb WHERE org_id = $1`,
      [a.orgId],
    );
    expect((await patchFooter(a, 'x')).status).toBe(422);
  });
});

describe('plan cards: GET /v2/plans and the onboarding plan step', () => {
  const cardsOf = (body: { data: PlanCard[] }) => body.data.map((c) => c.slug);
  const actionsOf = (body: { data: PlanCard[] }) =>
    Object.fromEntries(body.data.map((c) => [c.slug, c.action]));

  /** free, basic, pro (+ twin and an offer), team (with a tiny offer), enterprise (custom quote) and a hidden retired plan. */
  async function seedCatalogue() {
    await freePlan('c_free', { sortOrder: 1, isDefault: true, features: { automation: true } });
    await paidPlan('c_basic', '10', { sortOrder: 2 });
    await paidPlan('c_pro', '30', {
      sortOrder: 3,
      offerAmount: '20',
      isHighlighted: true,
      ctaLabel: 'Go Pro',
      subtitle: 'For teams',
      limits: { monthly_messages: 5000 },
      features: { analytics: true, automation: true, ai_assistants: true, calling: true },
    });
    await paidPlan('c_pro_b', '30', { sortOrder: 3 });
    await paidPlan('c_team', '60', { sortOrder: 4, offerAmount: '5' });
    await makePlan({ name: 'Enterprise', slug: 'c_enterprise', isCustomQuote: true, sortOrder: 5 });
    await paidPlan('c_retired', '5', { sortOrder: 0, isActive: false });
  }

  it('returns {data, currentSlug, trialEndsAt} with active plans in sort order then price, inactive hidden', async () => {
    await seedCatalogue();
    const a = await signup();
    const res = await api().get('/v2/plans').set(bearer(a.access));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['currentSlug', 'data', 'trialEndsAt']);
    expect(plansResponseSchema.safeParse(res.body).success).toBe(true);
    expect(cardsOf(res.body)).toEqual([
      'c_free',
      'c_basic',
      'c_pro',
      'c_pro_b',
      'c_team',
      'c_enterprise',
    ]);
    expect(cardsOf(res.body)).not.toContain('c_retired');
    for (const card of res.body.data as PlanCard[]) {
      expect(card.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('builds each card: kind, price strings, period, chips (first three, fixed order), monthly messages, highlight, label', async () => {
    await seedCatalogue();
    await paidPlan('c_forever', '299', { sortOrder: 6, isLifetime: true, offerAmount: '199' });
    const a = await signup();
    const body = (await api().get('/v2/plans').set(bearer(a.access))).body;
    const bySlug = Object.fromEntries((body.data as PlanCard[]).map((c) => [c.slug, c]));

    expect(bySlug.c_pro).toMatchObject({
      name: 'c_pro',
      subtitle: 'For teams',
      kind: 'paid',
      price: {
        amount: '30.00',
        offerAmount: '20.00',
        currency: 'USD',
        period: { unit: 'months', count: 1 },
      },
      lifetime: false,
      monthlyMessages: 5000,
      chips: ['analytics', 'automation', 'ai_assistants'],
      highlighted: true,
      ctaLabel: 'Go Pro',
    });
    expect(bySlug.c_free).toMatchObject({
      kind: 'free',
      price: { amount: '0.00', offerAmount: null, period: null },
      lifetime: false,
      monthlyMessages: 0,
      highlighted: false,
      ctaLabel: 'Get started',
    });
    expect(bySlug.c_enterprise).toMatchObject({
      kind: 'custom_quote',
      price: { amount: '0.00', offerAmount: null, period: null },
      action: 'contact_sales',
    });
    expect(bySlug.c_forever).toMatchObject({
      kind: 'paid',
      lifetime: true,
      price: { amount: '299.00', offerAmount: '199.00', period: null },
    });
    // A plan created through the API stores every flag, so only what the operator ticked shows as a chip.
    expect(bySlug.c_free.chips).toEqual(['automation']);
    expect(bySlug.c_pro_b.chips).toEqual([]);
  });

  it('marks the current plan and ranks by LIST price from each starting point', async () => {
    await seedCatalogue();
    const onFree = await signup();
    const onBasic = await signup();
    const onPro = await signup();
    const onEnterprise = await signup();
    await putOnPlan(onBasic.orgId, 'c_basic');
    await putOnPlan(onPro.orgId, 'c_pro');
    await putOnPlan(onEnterprise.orgId, 'c_enterprise');
    const get = async (a: Account) => (await api().get('/v2/plans').set(bearer(a.access))).body;

    const free = await get(onFree);
    expect(free.currentSlug).toBe('c_free');
    expect(actionsOf(free)).toEqual({
      c_free: 'current',
      c_basic: 'upgrade',
      c_pro: 'upgrade',
      c_pro_b: 'upgrade',
      c_team: 'upgrade',
      c_enterprise: 'contact_sales',
    });
    expect(free.data.filter((c: PlanCard) => c.current).map((c: PlanCard) => c.slug)).toEqual([
      'c_free',
    ]);

    const basic = await get(onBasic);
    // The team plan's offer (5) is below the basic list price (10); ranking ignores offers, so it is still an upgrade.
    expect(actionsOf(basic)).toEqual({
      c_free: 'continue_free',
      c_basic: 'current',
      c_pro: 'upgrade',
      c_pro_b: 'upgrade',
      c_team: 'upgrade',
      c_enterprise: 'contact_sales',
    });

    const pro = await get(onPro);
    expect(actionsOf(pro)).toEqual({
      c_free: 'continue_free',
      c_basic: 'downgrade_unavailable',
      c_pro: 'current',
      c_pro_b: 'choose',
      c_team: 'upgrade',
      c_enterprise: 'contact_sales',
    });

    // A current custom quote is the top tier: every paid plan is below it.
    const enterprise = await get(onEnterprise);
    expect(actionsOf(enterprise)).toEqual({
      c_free: 'continue_free',
      c_basic: 'downgrade_unavailable',
      c_pro: 'downgrade_unavailable',
      c_pro_b: 'downgrade_unavailable',
      c_team: 'downgrade_unavailable',
      c_enterprise: 'current',
    });
  });

  it('an organization on an unknown or inactive plan: nothing is current, and the ranking still works where it can', async () => {
    await seedCatalogue();
    const onGhost = await signup();
    await putOnPlan(onGhost.orgId, 'starter');
    const ghost = (await api().get('/v2/plans').set(bearer(onGhost.access))).body;
    expect(ghost.currentSlug).toBe('starter');
    expect(ghost.data.some((c: PlanCard) => c.current)).toBe(false);
    expect(actionsOf(ghost)).toEqual({
      c_free: 'continue_free',
      c_basic: 'choose',
      c_pro: 'choose',
      c_pro_b: 'choose',
      c_team: 'choose',
      c_enterprise: 'contact_sales',
    });

    // On the hidden retired plan (list price 5): it is not offered, yet it still ranks the others.
    const onRetired = await signup();
    await putOnPlan(onRetired.orgId, 'c_retired');
    const retired = (await api().get('/v2/plans').set(bearer(onRetired.access))).body;
    expect(retired.currentSlug).toBe('c_retired');
    expect(cardsOf(retired)).not.toContain('c_retired');
    expect(retired.data.some((c: PlanCard) => c.current)).toBe(false);
    expect(actionsOf(retired).c_basic).toBe('upgrade');
    expect(actionsOf(retired).c_team).toBe('upgrade');
  });

  it('is empty, not an error, when the operator has set up no plans', async () => {
    const a = await signup();
    const res = await api().get('/v2/plans').set(bearer(a.access));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], currentSlug: 'starter', trialEndsAt: null });
  });

  it('shows the organization its own trial end and nobody else’s', async () => {
    await freePlan(slugOf('trial_plan'), { isDefault: true });
    await setRegistration({ trialDays: 10 });
    const trial = await signup();
    await setRegistration({ trialDays: 0 });
    const noTrial = await signup();

    const t = (await api().get('/v2/plans').set(bearer(trial.access))).body;
    const n = (await api().get('/v2/plans').set(bearer(noTrial.access))).body;
    expect(t.trialEndsAt).not.toBeNull();
    expect(new Date(t.trialEndsAt).getTime()).toBeGreaterThan(Date.now() + 9 * DAY);
    expect(new Date(t.trialEndsAt).getTime()).toBeLessThan(Date.now() + 10 * DAY + 60_000);
    expect(n.trialEndsAt).toBeNull();
  });

  it('is the same list the onboarding step shows, with the current plan marked', async () => {
    await seedCatalogue();
    await setRegistration({ trialDays: 14 });
    const a = await signup();
    const onboarding = await api().get('/v2/onboarding').set(bearer(a.access));
    expect(onboarding.status).toBe(200);
    expect(onboardingResponseSchema.safeParse(onboarding.body).success).toBe(true);
    expect(onboarding.body.step).toBe('workspace');
    const plans = await api().get('/v2/plans').set(bearer(a.access));
    expect(onboarding.body.plans).toEqual(plans.body.data);
    expect(onboarding.body.plans.find((c: PlanCard) => c.current)?.slug).toBe('c_free');
    expect(cardsOf({ data: onboarding.body.plans })).not.toContain('c_retired');
  });

  it('start free / skip finishes onboarding without changing the plan', async () => {
    await seedCatalogue();
    const a = await signup();
    const before = await stateOf(a.orgId);
    const done = await api().post('/v2/onboarding/complete').set(bearer(a.access));
    expect(done.status).toBeLessThan(300);
    expect(done.body.step).toBe('done');
    const after = await stateOf(a.orgId);
    expect(after.plan).toBe(before.plan);
    expect(after.trial_ends_at?.getTime()).toBe(before.trial_ends_at?.getTime());
  });

  it('reflects an operator edit at once: a deactivated plan disappears, a new one appears', async () => {
    const a = await signup();
    const first = await paidPlan(slugOf('live_a'), '10');
    const second = await paidPlan(slugOf('live_b'), '20');
    let body = (await api().get('/v2/plans').set(bearer(a.access))).body;
    expect(cardsOf(body)).toEqual([first.slug, second.slug]);

    await ops('patch', `/plans/${first.id}/active`).send({ isActive: false });
    body = (await api().get('/v2/plans').set(bearer(a.access))).body;
    expect(cardsOf(body)).toEqual([second.slug]);

    await ops('patch', `/plans/${second.id}`).send({ sortOrder: 0, name: 'Renamed Live' });
    const third = await paidPlan(slugOf('live_c'), '5', { sortOrder: 1 });
    body = (await api().get('/v2/plans').set(bearer(a.access))).body;
    expect(cardsOf(body)).toEqual([second.slug, third.slug]);
    expect(body.data[0].name).toBe('Renamed Live');
  });

  it('is reachable while the account is gated by an unverified email, and still needs a tenant sign-in', async () => {
    await seedCatalogue();
    const a = await signup();
    await setRegistration({ emailVerification: 'block' });
    try {
      const gated = await api().get('/v2/users/me').set(bearer(a.access));
      expect(gated.body.code).toBe('AUTH_EMAIL_UNVERIFIED');
      const plans = await api().get('/v2/plans').set(bearer(a.access));
      expect(plans.status).toBe(200);
      expect(cardsOf(plans.body)).toContain('c_pro');
      expect((await api().get('/v2/onboarding').set(bearer(a.access))).status).toBe(200);
      expect((await api().get('/v2/plans')).status).toBe(401);
    } finally {
      await setRegistration({ emailVerification: 'banner' });
    }
  });
});
