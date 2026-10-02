import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  billingPlansResponseSchema,
  billingStatusSchema,
  billingUsageResponseSchema,
  changePlanResponseSchema,
  workspacePlanListResponseSchema,
  workspacePlanSchema,
  type BillingPlan,
} from '@crm/contracts';
import { RbacService } from '../../../src/kernel/rbac/rbac.service';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * Plans, subscriptions, trials and limits per WORKSPACE, end to end through HTTP (TW-PLAN-011..017):
 *   - a workspace admin sees every active plan and can upgrade (checkout), downgrade, switch; nobody else can
 *   - the super admin attaches plans and per-workspace limits; support operators cannot
 *   - the trial hard gate, the lapsed-plan fallback and the caps follow the workspace, never another one
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Str0ngPassw0rd#1';
const DAY = 86_400_000;
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let ipCounter = 10;
const nextIp = () => `10.9.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
let counter = 0;

let superToken = '';
let supportToken = '';
const ops = (
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  token = superToken,
) => api()[method](`/v2/platform${path}`).set(bearer(token));

interface Account {
  email: string;
  slug: string;
  uuid: string;
  access: string;
  orgId: number;
}

async function signup(): Promise<Account> {
  const email = `billing${Date.now()}${counter++}@example.test`;
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', nextIp())
    .send({
      orgName: `Billing Org ${counter}`,
      fullName: 'Bill Person',
      email,
      password: PASSWORD,
      acceptTerms: true,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const access = res.body.tokens.accessToken as string;
  const session = await api().get('/v2/auth/session').set(bearer(access));
  const slug = session.body.org.slug as string;
  const row = await h.owner.query(`SELECT id, uuid FROM organizations WHERE slug = $1`, [slug]);
  return { email, slug, access, orgId: Number(row.rows[0].id), uuid: row.rows[0].uuid as string };
}

const as = (a: Account, method: 'get' | 'post', path: string) =>
  api()[method](path).set(bearer(a.access));

const changePlan = (a: Account, planSlug: string) =>
  as(a, 'post', '/v2/billing/plan').set('idempotency-key', randomUUID()).send({ planSlug });

async function makePlan(body: Record<string, unknown>) {
  const res = await ops('post', '/plans').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; slug: string };
}
const freePlan = (slug: string, extra: Record<string, unknown> = {}) =>
  makePlan({ name: slug, slug, isFree: true, ...extra });
const paidPlan = (slug: string, amount: string, extra: Record<string, unknown> = {}) =>
  makePlan({ name: slug, slug, amount, ...extra });

const setOrgState = (
  orgId: number,
  plan: string,
  trialEndsAt: Date | null,
  planEndsAt: Date | null,
) =>
  h.owner.query(
    `WITH o AS (UPDATE organizations SET plan = $2 WHERE id = $1)
     INSERT INTO org_plan_state (org_id, trial_ends_at, plan_ends_at) VALUES ($1, $3, $4)
     ON CONFLICT (org_id) DO UPDATE SET trial_ends_at = EXCLUDED.trial_ends_at, plan_ends_at = EXCLUDED.plan_ends_at`,
    [orgId, plan, trialEndsAt, planEndsAt],
  );

async function stateOf(orgId: number) {
  const res = await h.owner.query(
    `SELECT o.plan, s.trial_ends_at, s.plan_ends_at, s.billing_cycle, s.overrides
       FROM organizations o JOIN org_plan_state s ON s.org_id = o.id WHERE o.id = $1`,
    [orgId],
  );
  return res.rows[0] as {
    plan: string;
    trial_ends_at: Date | null;
    plan_ends_at: Date | null;
    billing_cycle: string;
    overrides: Record<string, unknown>;
  };
}

const addContact = (a: Account, n: number) =>
  as(a, 'post', '/v2/contacts').send({ name: `C${n}`, phone: `+9198123${String(40000 + n)}` });

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
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
  supportToken = supportLogin.body.tokens.accessToken as string;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  await h.owner.query('DELETE FROM plans');
  const res = await ops('patch', '/settings/registration').send({
    defaultPlanId: null,
    trialDays: 14,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
});

describe('the workspace admin sees every plan, scoped to their workspace', () => {
  it('lists all active plans with the workspace plan marked and the right action per card', async () => {
    await freePlan('starter_free', { sortOrder: 1 });
    await paidPlan('pro', '49', { sortOrder: 2, limits: { contacts: 5000 } });
    await paidPlan('mini', '19', { sortOrder: 3 });
    await paidPlan('biz', '99', { sortOrder: 4, isHighlighted: true });
    await makePlan({ name: 'Enterprise', slug: 'enterprise', isCustomQuote: true, sortOrder: 5 });
    await paidPlan('hidden', '5', { isActive: false });
    const a = await signup();
    await setOrgState(a.orgId, 'pro', null, new Date(Date.now() + 20 * DAY));

    const res = await as(a, 'get', '/v2/billing/plans');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = billingPlansResponseSchema.parse(res.body);
    expect(body.canManage).toBe(true);
    expect(body.current).toMatchObject({ slug: 'pro', kind: 'paid' });
    expect(body.validity).toMatchObject({ state: 'paid_active', renewalWindow: false });
    const by = Object.fromEntries(body.data.map((p) => [p.slug, p])) as Record<string, BillingPlan>;
    expect(Object.keys(by).sort()).toEqual(['biz', 'enterprise', 'mini', 'pro', 'starter_free']);
    expect(by.pro).toMatchObject({ current: true, action: 'current', via: 'none' });
    expect(by.biz).toMatchObject({ action: 'upgrade', via: 'checkout' });
    expect(by.mini).toMatchObject({ action: 'downgrade', via: 'change' });
    expect(by.starter_free).toMatchObject({ action: 'downgrade', via: 'change' });
    expect(by.enterprise).toMatchObject({ action: 'contact_sales', via: 'sales' });
    expect(by.pro?.limits.contacts).toBe(5000);
  });

  it('keeps one workspace’s plan out of another’s view', async () => {
    await freePlan('free_a');
    await paidPlan('paid_b', '30');
    const a = await signup();
    const b = await signup();
    await setOrgState(b.orgId, 'paid_b', null, null);
    const ra = billingPlansResponseSchema.parse((await as(a, 'get', '/v2/billing/plans')).body);
    const rb = billingPlansResponseSchema.parse((await as(b, 'get', '/v2/billing/plans')).body);
    expect(ra.current?.slug).toBe('free_a');
    expect(rb.current?.slug).toBe('paid_b');
  });

  it('reports the trial and renewal bars from one payload', async () => {
    await freePlan('free_t');
    await paidPlan('paid_r', '30');
    const a = await signup();
    await setOrgState(a.orgId, 'free_t', new Date(Date.now() + 36 * 3_600_000), null);
    let st = billingStatusSchema.parse((await as(a, 'get', '/v2/billing/status')).body);
    expect(st).toMatchObject({ state: 'free_trial', daysLeft: 2, planSlug: 'free_t' });
    await setOrgState(a.orgId, 'paid_r', null, new Date(Date.now() + 5 * DAY));
    st = billingStatusSchema.parse((await as(a, 'get', '/v2/billing/status')).body);
    expect(st).toMatchObject({ state: 'paid_active', daysLeft: 5, renewalWindow: true });
  });
});

describe('workspace admin changes the plan', () => {
  it('downgrades paid -> cheaper paid at once, keeping the paid period', async () => {
    await paidPlan('pro', '49');
    await paidPlan('mini', '19');
    const a = await signup();
    const end = new Date(Date.now() + 20 * DAY);
    await setOrgState(a.orgId, 'pro', null, end);
    const res = await changePlan(a, 'mini');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = changePlanResponseSchema.parse(res.body);
    expect(body).toMatchObject({ planSlug: 'mini', direction: 'downgrade' });
    const st = await stateOf(a.orgId);
    expect(st.plan).toBe('mini');
    expect(st.trial_ends_at).toBeNull();
    expect(new Date(st.plan_ends_at!).getTime()).toBe(end.getTime());
  });

  it('downgrades to a free plan: period cleared, no trial restarted, audited, event emitted', async () => {
    await freePlan('free_p');
    await paidPlan('pro', '49');
    const a = await signup();
    await setOrgState(a.orgId, 'pro', null, new Date(Date.now() + 20 * DAY));
    const res = await changePlan(a, 'free_p');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ planSlug: 'free_p', direction: 'downgrade' });
    expect(res.body.validity.state).toBe('free');
    const st = await stateOf(a.orgId);
    expect(st).toMatchObject({ plan: 'free_p', trial_ends_at: null, plan_ends_at: null });
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'plans'`,
      [a.orgId],
    );
    expect(audit.rows[0].delta.plan).toEqual({ old: 'pro', new: 'free_p' });
    const ev = await h.owner.query(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'plan.changed'`,
      [a.orgId],
    );
    expect(ev.rows[0].payload).toMatchObject({ from: 'pro', to: 'free_p', direction: 'downgrade' });
  });

  it('switching one free plan for another neither extends nor skips the trial', async () => {
    await freePlan('free_one');
    await freePlan('free_two');
    const a = await signup();
    const trial = new Date(Date.now() + 3 * DAY);
    await setOrgState(a.orgId, 'free_one', trial, null);
    const res = await changePlan(a, 'free_two');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.direction).toBe('switch');
    const st = await stateOf(a.orgId);
    expect(st.plan).toBe('free_two');
    expect(new Date(st.trial_ends_at!).getTime()).toBe(trial.getTime());
  });

  it('refuses a dearer paid plan with the checkout link, a custom quote, the same plan, an inactive or unknown plan', async () => {
    await freePlan('free_x');
    await paidPlan('pro', '49');
    await paidPlan('biz', '99');
    await paidPlan('old', '10', { isActive: false });
    await makePlan({ name: 'Ent', slug: 'ent', isCustomQuote: true });
    const a = await signup();
    await setOrgState(a.orgId, 'pro', null, null);

    const up = await changePlan(a, 'biz');
    expect(up.status).toBe(422);
    expect(up.body.code).toBe('PLAN_CHECKOUT_REQUIRED');
    expect(up.body.errors).toContainEqual({
      path: 'checkoutUrl',
      message: '/billing/checkout/biz',
    });

    expect((await changePlan(a, 'ent')).body.code).toBe('PLAN_CHANGE_NOT_ALLOWED');
    expect((await changePlan(a, 'pro')).body.code).toBe('PLAN_CHANGE_NOT_ALLOWED');
    expect((await changePlan(a, 'old')).body.code).toBe('PLAN_CHANGE_NOT_ALLOWED');
    expect((await changePlan(a, 'nope')).status).toBe(404);
    expect((await stateOf(a.orgId)).plan).toBe('pro');
  });

  it('warns about caps the new plan sets below what the workspace holds, and deletes nothing', async () => {
    await paidPlan('pro', '49');
    await freePlan('free_small', { limits: { contacts: 1 } });
    const a = await signup();
    await setOrgState(a.orgId, 'pro', null, null);
    expect((await addContact(a, 1)).status).toBe(201);
    expect((await addContact(a, 2)).status).toBe(201);
    const res = await changePlan(a, 'free_small');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.overLimit).toContainEqual({ key: 'contacts', used: 2, limit: 1 });
    const kept = await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [
      a.orgId,
    ]);
    expect(kept.rows[0].n).toBe(2);
    const blocked = await addContact(a, 3);
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('is refused for a member without plan.subscription.manage, while viewing stays open', async () => {
    await freePlan('free_m');
    await paidPlan('pro', '49');
    const a = await signup();
    await setOrgState(a.orgId, 'pro', null, null);
    // Demote the signed-in member to the Viewer preset, which does not hold the key.
    await h.owner.query(
      `UPDATE user_roles ur SET role_id = (SELECT id FROM roles WHERE org_id = $1 AND system_key = 'viewer')
        WHERE ur.org_id = $1`,
      [a.orgId],
    );
    await h.app.get(RbacService).bumpRolesVersion(a.orgId);
    const denied = await changePlan(a, 'free_m');
    expect(denied.status).toBe(403);
    expect((await stateOf(a.orgId)).plan).toBe('pro');
    // Viewing stays open to every member.
    const view = billingPlansResponseSchema.parse((await as(a, 'get', '/v2/billing/plans')).body);
    expect(view.canManage).toBe(false);
  });

  it('never touches another workspace', async () => {
    await freePlan('free_i');
    await paidPlan('pro', '49');
    const a = await signup();
    const b = await signup();
    await setOrgState(a.orgId, 'pro', null, null);
    await setOrgState(b.orgId, 'pro', null, null);
    expect((await changePlan(a, 'free_i')).status).toBe(201);
    expect((await stateOf(a.orgId)).plan).toBe('free_i');
    expect((await stateOf(b.orgId)).plan).toBe('pro');
  });
});

describe('the trial hard gate and the lapsed-plan fallback', () => {
  it('answers 402 on feature routes after the trial, keeps billing reachable, and lifts on a plan', async () => {
    await freePlan('free_g');
    await paidPlan('pro', '49');
    const a = await signup();
    await setOrgState(a.orgId, 'free_g', new Date(Date.now() - DAY), null);

    const blocked = await as(a, 'get', '/v2/contacts');
    expect(blocked.status).toBe(402);
    expect(blocked.body.code).toBe('PLAN_TRIAL_EXPIRED');
    expect(blocked.body.errors).toContainEqual({ path: 'upgradeUrl', message: '/account/plans' });
    expect(blocked.body.errors).toContainEqual({ path: 'trial', message: 'expired' });

    const view = await as(a, 'get', '/v2/billing/plans');
    expect(view.status).toBe(200);
    expect(view.body.validity.state).toBe('free_trial_expired');
    expect((await as(a, 'get', '/v2/billing/status')).status).toBe(200);
    expect((await as(a, 'get', '/v2/auth/session')).status).toBe(200);

    // The operator gives the workspace a paid plan: the very next request passes.
    const org = await h.owner.query(`SELECT row_version FROM org_plan_state WHERE org_id = $1`, [
      a.orgId,
    ]);
    const attach = await ops('put', `/workspace-plans/${a.uuid}`).send({
      planSlug: 'pro',
      rowVersion: org.rows[0].row_version,
    });
    expect(attach.status, JSON.stringify(attach.body)).toBe(200);
    expect((await as(a, 'get', '/v2/contacts')).status).toBe(200);
  });

  it('does not gate a free workspace with no trial, a running trial, or a paid plan', async () => {
    await freePlan('free_n');
    await paidPlan('pro', '49');
    const a = await signup();
    await setOrgState(a.orgId, 'free_n', null, null);
    expect((await as(a, 'get', '/v2/contacts')).status).toBe(200);
    await setOrgState(a.orgId, 'free_n', new Date(Date.now() + DAY), null);
    expect((await as(a, 'get', '/v2/contacts')).status).toBe(200);
    // A stale trial date on a paid plan is never gated (TW-PLAN-015 rule 3).
    await setOrgState(a.orgId, 'pro', new Date(Date.now() - DAY), null);
    expect((await as(a, 'get', '/v2/contacts')).status).toBe(200);
  });

  it('treats a lapsed paid plan as the free plan: caps shrink, paid flags lock', async () => {
    await freePlan('free_l', { limits: { contacts: 1 } });
    await paidPlan('pro', '49', { limits: { contacts: 0 } });
    const a = await signup();
    await setOrgState(a.orgId, 'pro', null, new Date(Date.now() + 10 * DAY));
    expect((await addContact(a, 1)).status).toBe(201);
    expect((await addContact(a, 2)).status).toBe(201);
    await setOrgState(a.orgId, 'pro', null, new Date(Date.now() - DAY));
    const view = billingPlansResponseSchema.parse((await as(a, 'get', '/v2/billing/plans')).body);
    expect(view.validity.state).toBe('paid_lapsed');
    expect(view.current?.slug).toBe('free_l');
    expect(view.data.find((p) => p.slug === 'pro')?.via).toBe('checkout');
    const blocked = await addContact(a, 3);
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('PLAN_LIMIT_REACHED');
  });
});

describe('usage', () => {
  it('shows used against the cap for this workspace only', async () => {
    await paidPlan('pro', '49', { limits: { contacts: 10, tags: 3 } });
    const a = await signup();
    const b = await signup();
    await setOrgState(a.orgId, 'pro', null, null);
    await setOrgState(b.orgId, 'pro', null, null);
    await addContact(a, 1);
    await addContact(a, 2);
    await addContact(b, 3);
    const res = await as(a, 'get', '/v2/billing/usage');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const usage = billingUsageResponseSchema.parse(res.body);
    const contacts = usage.meters.find((m) => m.key === 'contacts');
    expect(contacts).toMatchObject({ used: 2, limit: 10, percent: 20, window: 'total' });
    expect(usage.meters.find((m) => m.key === 'tags')).toMatchObject({ limit: 3 });
    expect(usage.meters.find((m) => m.key === 'monthly_messages')).toMatchObject({
      limit: 0,
      percent: null,
      window: 'month',
    });
    expect(usage.features.length).toBeGreaterThan(0);
  });
});

describe('the super admin attaches plans and limits per workspace', () => {
  it('lists workspaces with search and a cursor, and shows the plan, validity and overrides', async () => {
    await freePlan('free_o');
    const a = await signup();
    const b = await signup();
    const list = workspacePlanListResponseSchema.parse(
      (await ops('get', '/workspace-plans?limit=1')).body,
    );
    expect(list.data).toHaveLength(1);
    expect(list.nextCursor).not.toBeNull();
    const next = workspacePlanListResponseSchema.parse(
      (await ops('get', `/workspace-plans?limit=1&cursor=${list.nextCursor}`)).body,
    );
    expect(next.data[0]?.workspaceId).not.toBe(list.data[0]?.workspaceId);
    const found = workspacePlanListResponseSchema.parse(
      (await ops('get', `/workspace-plans?search=${a.slug}`)).body,
    );
    expect(found.data.map((w) => w.workspaceId)).toEqual([a.uuid]);
    const one = workspacePlanSchema.parse((await ops('get', `/workspace-plans/${b.uuid}`)).body);
    expect(one.workspaceId).toBe(b.uuid);
  });

  it('attaches a plan: clears the trial, stamps the period, sets per-workspace caps that beat the plan', async () => {
    await freePlan('free_a');
    await paidPlan('pro', '49', { limits: { contacts: 100 } });
    const a = await signup();
    await setOrgState(a.orgId, 'free_a', new Date(Date.now() + 5 * DAY), null);
    const before = workspacePlanSchema.parse((await ops('get', `/workspace-plans/${a.uuid}`)).body);

    const res = await ops('put', `/workspace-plans/${a.uuid}`).send({
      planSlug: 'pro',
      rowVersion: before.rowVersion,
      overrides: { limits: { contacts: 2 }, features: { calling: true } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = workspacePlanSchema.parse(res.body);
    expect(after).toMatchObject({ planSlug: 'pro', billingCycle: 'monthly' });
    expect(after.validity.state).toBe('paid_active');
    expect(after.validity.planEndsAt).not.toBeNull();
    expect(after.overrides).toEqual({ limits: { contacts: 2 }, features: { calling: true } });
    const st = await stateOf(a.orgId);
    expect(st.trial_ends_at).toBeNull();

    // The override (2) beats the plan (100).
    expect((await addContact(a, 1)).status).toBe(201);
    expect((await addContact(a, 2)).status).toBe(201);
    const third = await addContact(a, 3);
    expect(third.status).toBe(422);
    expect(third.body.code).toBe('PLAN_LIMIT_REACHED');
    const usage = billingUsageResponseSchema.parse((await as(a, 'get', '/v2/billing/usage')).body);
    expect(usage.meters.find((m) => m.key === 'contacts')).toMatchObject({ used: 2, limit: 2 });
    expect(usage.features.find((f) => f.key === 'calling')?.enabled).toBe(true);

    const sec = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.workspace.plan_attached' AND subject_org_id = $1`,
      [a.orgId],
    );
    expect(sec.rows[0].payload).toMatchObject({ plan: { from: 'free_a', to: 'pro' } });
    const audit = await h.owner.query(
      `SELECT actor_type FROM audit_log WHERE org_id = $1 AND module = 'plans'`,
      [a.orgId],
    );
    expect(audit.rows[0].actor_type).toBe('platform_operator');
    const ev = await h.owner.query(
      `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'plan.attached'`,
      [a.orgId],
    );
    expect(ev.rows).toHaveLength(1);
  });

  it('re-attaching the same plan edits only the date and the overrides', async () => {
    await paidPlan('pro', '49');
    const a = await signup();
    await setOrgState(a.orgId, 'pro', null, new Date(Date.now() + 5 * DAY));
    const before = workspacePlanSchema.parse((await ops('get', `/workspace-plans/${a.uuid}`)).body);
    const fixed = new Date(Date.now() + 90 * DAY).toISOString();
    const res = await ops('put', `/workspace-plans/${a.uuid}`).send({
      planSlug: 'pro',
      planEndsAt: fixed,
      rowVersion: before.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.validity.planEndsAt).toBe(fixed);
    expect(res.body.overrides).toEqual({ limits: {}, features: {} });
    const never = await ops('put', `/workspace-plans/${a.uuid}`).send({
      planSlug: 'pro',
      planEndsAt: null,
      rowVersion: res.body.rowVersion,
    });
    expect(never.body.validity.planEndsAt).toBeNull();
  });

  it('refuses a stale row version, an unknown plan or workspace, bad override keys, and a support operator', async () => {
    await paidPlan('pro', '49');
    const a = await signup();
    const before = workspacePlanSchema.parse((await ops('get', `/workspace-plans/${a.uuid}`)).body);
    const stale = await ops('put', `/workspace-plans/${a.uuid}`).send({
      planSlug: 'pro',
      rowVersion: before.rowVersion + 5,
    });
    expect(stale.status).toBe(409);
    expect(
      (
        await ops('put', `/workspace-plans/${a.uuid}`).send({
          planSlug: 'ghost',
          rowVersion: before.rowVersion,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await ops('put', `/workspace-plans/${randomUUID()}`).send({
          planSlug: 'pro',
          rowVersion: 1,
        })
      ).status,
    ).toBe(404);
    const bad = await ops('put', `/workspace-plans/${a.uuid}`).send({
      planSlug: 'pro',
      rowVersion: before.rowVersion,
      overrides: { limits: { bogus: 1 }, features: {} },
    });
    expect(bad.status).toBe(422);
    const denied = await ops('put', `/workspace-plans/${a.uuid}`, supportToken).send({
      planSlug: 'pro',
      rowVersion: before.rowVersion,
    });
    expect(denied.status).toBe(403);
    // Support may read.
    expect((await ops('get', `/workspace-plans/${a.uuid}`, supportToken)).status).toBe(200);
    expect((await stateOf(a.orgId)).plan).not.toBe('pro');
  });

  it('keeps the operator console closed to workspace users and the workspace billing routes closed to operators', async () => {
    const a = await signup();
    expect((await as(a, 'get', '/v2/platform/workspace-plans')).status).toBeGreaterThanOrEqual(401);
    expect((await ops('get', '/workspace-plans')).status).toBe(200);
    const asOperator = await api().get('/v2/billing/plans').set(bearer(superToken));
    expect(asOperator.status).toBeGreaterThanOrEqual(401);
  });
});
