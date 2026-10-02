import { createHmac, randomUUID } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
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
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  PlanQuotaService,
  PlanUsageService,
} from '../../../src/modules/plans-subscriptions-trials';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { RbacService } from '../../../src/kernel/rbac/rbac.service';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * Plans, subscriptions, trials and limits per WORKSPACE, end to end through HTTP (WD-PLAN-011..017):
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
    // A stale trial date on a paid plan is never gated (WD-PLAN-015 rule 3).
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
    expect(after.overrides).toEqual({
      limits: { contacts: 2 },
      features: { calling: true },
      dataRetentionDays: null,
    });
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
    expect(res.body.overrides).toEqual({ limits: {}, features: {}, dataRetentionDays: null });
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

describe('pricing FAQs (WD-PLAN-009)', () => {
  beforeEach(async () => {
    await h.owner.query('DELETE FROM pricing_faqs');
  });
  const faq = (body: Record<string, unknown>, token = superToken) =>
    api().post('/v2/platform/pricing-faqs').set(bearer(token)).send(body);

  it('adds a FAQ: no sort order takes the next after the maximum, active by default, audited', async () => {
    await h.owner.query(
      `INSERT INTO pricing_faqs (question, answer, sort_order) VALUES ('old', 'a', 6)`,
    );
    const res = await faq({ question: 'Can I switch?', answer: 'Any time.' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      sortOrder: 7,
      isActive: true,
      placement: 'pricing',
      rowVersion: 1,
    });
    const ev = await h.owner.query(
      `SELECT 1 FROM security_events WHERE event = 'platform.plan.faq_created'`,
    );
    expect(ev.rows).toHaveLength(1);
  });

  it('validates: an answer over 5000 characters, a blank question and a bad placement fail', async () => {
    expect((await faq({ question: 'q', answer: 'x'.repeat(5001) })).status).toBe(422);
    expect((await faq({ question: '  ', answer: 'a' })).status).toBe(422);
    expect((await faq({ question: 'q', answer: 'a', placement: 'nowhere' })).status).toBe(422);
    expect((await faq({ question: 'q', answer: 'x'.repeat(5000) })).status).toBe(201);
  });

  it('shows each reader its own set: in-app all active, public pricing pricing+both, home home+both; inactive hidden', async () => {
    await faq({ question: 'p', answer: 'a', placement: 'pricing' });
    await faq({ question: 'h', answer: 'a', placement: 'home' });
    await faq({ question: 'b', answer: 'a', placement: 'both' });
    const off = (await faq({ question: 'off', answer: 'a', placement: 'both' })).body;
    const patched = await api()
      .patch(`/v2/platform/pricing-faqs/${off.id}`)
      .set(bearer(superToken))
      .send({ isActive: false, rowVersion: off.rowVersion });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.isActive).toBe(false);

    const a = await signup();
    const inApp = await as(a, 'get', '/v2/billing/faqs');
    expect(inApp.body.data.map((f: { question: string }) => f.question)).toEqual(['p', 'h', 'b']);
    const pricing = await api().get('/v2/public/pricing-faqs?for=pricing');
    expect(pricing.body.data.map((f: { question: string }) => f.question)).toEqual(['p', 'b']);
    const home = await api().get('/v2/public/pricing-faqs?for=home');
    expect(home.body.data.map((f: { question: string }) => f.question)).toEqual(['h', 'b']);
    expect(JSON.stringify(pricing.body)).not.toMatch(/rowVersion|sortOrder|isActive/);
  });

  it('edits only what is sent, refuses a stale row version, deletes, and keeps writes for super admins', async () => {
    const made = (await faq({ question: 'q', answer: 'a', sortOrder: 3 })).body;
    const edit = await api()
      .patch(`/v2/platform/pricing-faqs/${made.id}`)
      .set(bearer(superToken))
      .send({ answer: 'better', rowVersion: made.rowVersion });
    expect(edit.body).toMatchObject({
      question: 'q',
      answer: 'better',
      sortOrder: 3,
      isActive: true,
      rowVersion: 2,
    });
    const stale = await api()
      .patch(`/v2/platform/pricing-faqs/${made.id}`)
      .set(bearer(superToken))
      .send({ answer: 'x', rowVersion: 1 });
    expect(stale.status).toBe(409);
    expect((await faq({ question: 'q', answer: 'a' }, supportToken)).status).toBe(403);
    expect((await api().get('/v2/platform/pricing-faqs').set(bearer(supportToken))).status).toBe(
      200,
    );
    expect(
      (await api().delete(`/v2/platform/pricing-faqs/${made.id}`).set(bearer(superToken))).status,
    ).toBe(204);
    expect(
      (await api().delete(`/v2/platform/pricing-faqs/${made.id}`).set(bearer(superToken))).status,
    ).toBe(404);
  });
});

describe('the yearly switch (WD-PLAN-011)', () => {
  it('prices a monthly plan as 12 months less the discount, matching checkout, and skips free, lifetime and yearly-authored plans', async () => {
    await freePlan('free_y');
    await paidPlan('pro', '49');
    await paidPlan('forever', '300', { isLifetime: true });
    await paidPlan('annual', '400', { billingUnit: 'years', billingDuration: 1 });
    const a = await signup();
    const view = billingPlansResponseSchema.parse((await as(a, 'get', '/v2/billing/plans')).body);
    const by = Object.fromEntries(view.data.map((p) => [p.slug, p]));
    expect(by.pro?.yearly).toEqual({ perMonth: '39.20', perYear: '470.40' });
    expect(by.free_y?.yearly).toBeNull();
    expect(by.forever?.yearly).toBeNull();
    expect(by.annual?.yearly).toBeNull();
    expect(view.yearlyToggle).toEqual({ enabled: true, discountPct: 20 });
  });

  it('hides the switch when no plan has a yearly price', async () => {
    await freePlan('free_only');
    const a = await signup();
    const view = billingPlansResponseSchema.parse((await as(a, 'get', '/v2/billing/plans')).body);
    expect(view.yearlyToggle.enabled).toBe(false);
  });
});

describe('cancel auto-renew (WD-PLAN-012)', () => {
  const sub = (orgId: number, over: Record<string, unknown> = {}) =>
    h.owner.query(
      `INSERT INTO subscriptions (org_id, gateway, gateway_subscription_id, status, current_period_end)
       VALUES ($1, $2, 'sub_1', $3, now() + interval '10 days')`,
      [orgId, over.gateway ?? 'stripe', over.status ?? 'active'],
    );
  const cancel = (a: Account) =>
    as(a, 'post', '/v2/billing/subscription/cancel').set('idempotency-key', randomUUID());

  it('shows the renewing subscription, cancels it, keeps the paid period and records that the gateway could not be told', async () => {
    await paidPlan('pro', '49');
    await ops('get', '/payment-gateways'); // makes sure the gateway rows exist (no credentials saved)
    const a = await signup();
    const end = new Date(Date.now() + 10 * DAY);
    await setOrgState(a.orgId, 'pro', null, end);
    await sub(a.orgId);

    const before = billingPlansResponseSchema.parse((await as(a, 'get', '/v2/billing/plans')).body);
    expect(before.subscription).toMatchObject({ status: 'active' });
    expect(
      billingStatusSchema.parse((await as(a, 'get', '/v2/billing/status')).body).subscription,
    ).not.toBeNull();

    const res = await cancel(a);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'canceled', remote: 'failed' });
    expect(new Date(res.body.planEndsAt).getTime()).toBe(end.getTime());
    const row = (
      await h.owner.query(`SELECT status, canceled_at, meta FROM subscriptions WHERE org_id = $1`, [
        a.orgId,
      ])
    ).rows[0];
    expect(row.status).toBe('canceled');
    expect(row.canceled_at).not.toBeNull();
    expect(row.meta.cancel.result).toBe('failed');
    expect((await stateOf(a.orgId)).plan_ends_at?.getTime()).toBe(end.getTime());
    const audit = await h.owner.query(
      `SELECT 1 FROM audit_log WHERE org_id = $1 AND module = 'subscriptions'`,
      [a.orgId],
    );
    expect(audit.rows).toHaveLength(1);
    const ev = await h.owner.query(
      `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'plan.subscription_canceled'`,
      [a.orgId],
    );
    expect(ev.rows).toHaveLength(1);

    const after = billingPlansResponseSchema.parse((await as(a, 'get', '/v2/billing/plans')).body);
    expect(after.subscription).toBeNull();
    const again = await cancel(a);
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('PLAN_NO_SUBSCRIPTION');
  });

  it('still cancels locally when the gateway is unknown, ignores a pending row, and is for plan managers only', async () => {
    const a = await signup();
    await sub(a.orgId, { gateway: 'nowhere' });
    await sub(a.orgId, { status: 'pending' });
    const res = await cancel(a);
    expect(res.body.remote).toBe('unsupported');
    const rows = (
      await h.owner.query(`SELECT status FROM subscriptions WHERE org_id = $1 ORDER BY id`, [
        a.orgId,
      ])
    ).rows;
    expect(rows.map((r) => r.status)).toEqual(['canceled', 'pending']);
    expect((await cancel(a)).body.code).toBe('PLAN_NO_SUBSCRIPTION');

    const b = await signup();
    await sub(b.orgId);
    await h.owner.query(
      `UPDATE user_roles ur SET role_id = (SELECT id FROM roles WHERE org_id = $1 AND system_key = 'viewer') WHERE ur.org_id = $1`,
      [b.orgId],
    );
    await h.app.get(RbacService).bumpRolesVersion(b.orgId);
    expect((await cancel(b)).status).toBe(403);
    expect(
      (await h.owner.query(`SELECT status FROM subscriptions WHERE org_id = $1`, [b.orgId])).rows[0]
        .status,
    ).toBe('active');
  });

  it('never touches another workspace’s subscription', async () => {
    const a = await signup();
    const b = await signup();
    await sub(b.orgId);
    expect((await cancel(a)).body.code).toBe('PLAN_NO_SUBSCRIPTION');
    expect(
      (await h.owner.query(`SELECT status FROM subscriptions WHERE org_id = $1`, [b.orgId])).rows[0]
        .status,
    ).toBe('active');
  });
});

describe('the delete-proof quota ledger (WD-PLAN-018)', () => {
  const quota = () => h.app.get(PlanQuotaService);
  const inTx = <T>(
    orgId: number,
    fn: (tx: Parameters<Parameters<DatabaseService['txAs']>[1]>[0]) => Promise<T>,
  ) => h.app.get(DatabaseService).txAs({ orgId, userId: null }, fn);
  const create = (orgId: number, live = async () => 0) =>
    inTx(orgId, async (tx) => {
      await quota().assertAvailable(tx, orgId, 'total_campaigns', 'campaign', live);
      await quota().bump(tx, orgId, 'campaign');
    });

  it('blocks the third create after create 2, delete 2, create 1: deleting never frees allowance', async () => {
    await paidPlan('capped', '10', { limits: { total_campaigns: 2 } });
    const a = await signup();
    await setOrgState(a.orgId, 'capped', null, null);
    await create(a.orgId);
    await create(a.orgId);
    // The two campaigns are "deleted": the live count is 0 again, the ledger still says 2.
    const err = await create(a.orgId).catch((e) => e);
    expect(err.code).toBe('PLAN_LIMIT_REACHED');
    expect(err.details).toContainEqual({ path: 'reason', message: 'quota_reached' });
    expect(err.message).toBe(
      "You've reached your plan's limit of 2 total campaigns. Upgrade your plan to create more.",
    );
    const usage = billingUsageResponseSchema.parse((await as(a, 'get', '/v2/billing/usage')).body);
    expect(usage.meters.find((m) => m.key === 'total_campaigns')).toMatchObject({
      used: 2,
      limit: 2,
    });
  });

  it('opens a fresh allowance when the plan changes, and treats a limit of 0 as unlimited', async () => {
    await paidPlan('capped', '10', { limits: { total_campaigns: 1 } });
    await paidPlan('roomy', '20', { limits: { total_campaigns: 0 } });
    const a = await signup();
    await setOrgState(a.orgId, 'capped', null, null);
    await create(a.orgId);
    expect((await create(a.orgId).catch((e) => e)).code).toBe('PLAN_LIMIT_REACHED');
    await setOrgState(a.orgId, 'roomy', null, null);
    await create(a.orgId);
    await create(a.orgId);
    await setOrgState(a.orgId, 'capped', null, null);
    // Back on the same plan with the same end date: the OLD counter returns (kept WaDesk quirk).
    expect((await create(a.orgId).catch((e) => e)).code).toBe('PLAN_LIMIT_REACHED');
  });

  it('adopts the live count the first time a workspace meets the metric, and only then', async () => {
    await paidPlan('capped', '10', { limits: { total_campaigns: 5 } });
    const a = await signup();
    await setOrgState(a.orgId, 'capped', null, null);
    // Three campaigns existed before the ledger did: the first create adopts 3, then counts its own.
    await create(a.orgId, async () => 3);
    const seeded = await h.owner.query(
      `SELECT count FROM plan_usage WHERE org_id = $1 AND metric = 'campaign'`,
      [a.orgId],
    );
    expect(seeded.rows[0].count).toBe(4);
    await create(a.orgId, async () => 99);
    expect((await create(a.orgId, async () => 99).catch((e) => e)).code).toBe('PLAN_LIMIT_REACHED');
    // A later period starts at 0 even though a live count is offered: old rows exist, nothing is adopted again.
    await setOrgState(a.orgId, 'capped', null, new Date(Date.now() + 30 * DAY));
    await create(a.orgId, async () => 99);
    const rows = await h.owner.query(
      `SELECT count FROM plan_usage WHERE org_id = $1 AND metric = 'campaign' ORDER BY id`,
      [a.orgId],
    );
    expect(rows.rows.map((r) => r.count)).toEqual([5, 1]);
  });

  it('counts concurrent creates exactly (atomic bump) and keeps workspaces apart', async () => {
    await paidPlan('capped', '10', { limits: { total_campaigns: 100 } });
    const a = await signup();
    const b = await signup();
    await setOrgState(a.orgId, 'capped', null, null);
    await setOrgState(b.orgId, 'capped', null, null);
    await Promise.all(Array.from({ length: 10 }, () => create(a.orgId)));
    await create(b.orgId);
    const count = async (orgId: number) =>
      (
        await h.owner.query(
          `SELECT sum(count)::int AS n FROM plan_usage WHERE org_id = $1 AND metric = 'campaign'`,
          [orgId],
        )
      ).rows[0].n;
    expect(await count(a.orgId)).toBe(10);
    expect(await count(b.orgId)).toBe(1);
  });
});

describe('data-retention wipe of lapsed workspaces (WD-PLAN-023)', () => {
  const run = (body: Record<string, unknown>, token = superToken) =>
    api().post('/v2/platform/workspace-plans/retention/run').set(bearer(token)).send(body);
  const contactsOf = async (orgId: number) =>
    (await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [orgId]))
      .rows[0].n as number;

  async function lapsedOrg(retention: number, lapsedDaysAgo: number) {
    const slug = `ret_${++counter}`;
    await paidPlan(slug, '30', { dataRetentionDays: retention });
    const a = await signup();
    await setOrgState(a.orgId, slug, null, new Date(Date.now() + 5 * DAY));
    expect((await addContact(a, counter)).status).toBe(201);
    expect((await addContact(a, counter + 1000)).status).toBe(201);
    await setOrgState(a.orgId, slug, null, new Date(Date.now() - lapsedDaysAgo * DAY));
    return { a, slug };
  }

  it('stores the retention days on the plan and validates the range', async () => {
    const ok = await ops('post', '/plans').send({
      name: 'Keep',
      slug: 'keepit',
      amount: '9',
      dataRetentionDays: 30,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.dataRetentionDays).toBe(30);
    expect(
      (await ops('post', '/plans').send({ name: 'Bad', amount: '9', dataRetentionDays: 3651 }))
        .status,
    ).toBe(422);
    expect(
      (await ops('post', '/plans').send({ name: 'Neg', amount: '9', dataRetentionDays: -1 }))
        .status,
    ).toBe(422);
  });

  it('a dry run counts what would go and deletes nothing; a real run needs the confirmation word', async () => {
    const { a } = await lapsedOrg(30, 31);
    const dry = await run({});
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    const mine = dry.body.workspaces.find((w: { slug: string }) => w.slug === a.slug);
    expect(dry.body.dryRun).toBe(true);
    expect(mine).toMatchObject({ wiped: false });
    expect(mine.rows.contacts).toBe(2);
    expect(await contactsOf(a.orgId)).toBe(2);
    expect((await stateOf(a.orgId)).plan).not.toBe('free_w');

    const unconfirmed = await run({ dryRun: false });
    expect(unconfirmed.status).toBe(422);
    expect(await contactsOf(a.orgId)).toBe(2);
    expect((await run({ dryRun: false, confirm: 'WIPE' }, supportToken)).status).toBe(403);
  });

  it('wipes once: data gone, stamped, switched to the free plan, audited with an event, kept data kept, never repeated', async () => {
    await freePlan('free_w');
    const { a } = await lapsedOrg(30, 31);
    await h.owner.query(`INSERT INTO tags (org_id, name) VALUES ($1, 'keepme')`, [a.orgId]);
    const res = await run({ dryRun: false, confirm: 'WIPE' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const mine = res.body.workspaces.find((w: { slug: string }) => w.slug === a.slug);
    expect(mine).toMatchObject({ wiped: true });
    expect(await contactsOf(a.orgId)).toBe(0);
    expect(
      (await h.owner.query(`SELECT count(*)::int AS n FROM tags WHERE org_id = $1`, [a.orgId]))
        .rows[0].n,
    ).toBe(1);
    expect(
      (await h.owner.query(`SELECT count(*)::int AS n FROM users WHERE org_id = $1`, [a.orgId]))
        .rows[0].n,
    ).toBe(1);
    const st = (
      await h.owner.query(
        `SELECT o.plan, s.data_wiped_at FROM organizations o JOIN org_plan_state s ON s.org_id = o.id WHERE o.id = $1`,
        [a.orgId],
      )
    ).rows[0];
    expect(st.plan).toBe('free_w');
    expect(st.data_wiped_at).not.toBeNull();
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'plans' AND action = 'delete'`,
      [a.orgId],
    );
    expect(audit.rows).toHaveLength(1);
    const ev = await h.owner.query(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'org.data_wiped'`,
      [a.orgId],
    );
    expect(ev.rows[0].payload.rowsDeleted).toBeGreaterThanOrEqual(2);

    await addContact(a, 5000); // new data after the wipe
    const again = await run({ dryRun: false, confirm: 'WIPE' });
    expect(again.body.workspaces.some((w: { slug: string }) => w.slug === a.slug)).toBe(false);
    expect(await contactsOf(a.orgId)).toBe(1);
  });

  it('wipes nothing for retention 0, inside the window, a free-trial-expired workspace, or a platform-owned one', async () => {
    const zero = await lapsedOrg(0, 400);
    const inside = await lapsedOrg(30, 29);
    await freePlan('free_t2');
    const trial = await signup();
    await addContact(trial, 7000);
    await setOrgState(trial.orgId, 'free_t2', new Date(Date.now() - 100 * DAY), null);
    const owned = await lapsedOrg(30, 90);
    await h.owner.query(`UPDATE org_plan_state SET platform_owned = true WHERE org_id = $1`, [
      owned.a.orgId,
    ]);

    const res = await run({ dryRun: false, confirm: 'WIPE' });
    const slugs = res.body.workspaces.map((w: { slug: string }) => w.slug);
    for (const x of [zero.a, inside.a, trial, owned.a]) expect(slugs).not.toContain(x.slug);
    expect(await contactsOf(zero.a.orgId)).toBe(2);
    expect(await contactsOf(inside.a.orgId)).toBe(2);
    expect(await contactsOf(trial.orgId)).toBe(1);
    expect(await contactsOf(owned.a.orgId)).toBe(2);
  });

  it('wipes only the lapsed workspace, never its neighbour', async () => {
    const lapsed = await lapsedOrg(30, 40);
    const neighbour = await lapsedOrg(0, 40);
    await run({ dryRun: false, confirm: 'WIPE' });
    expect(await contactsOf(lapsed.a.orgId)).toBe(0);
    expect(await contactsOf(neighbour.a.orgId)).toBe(2);
  });
});

describe('the one-line count guard for future domains (WD-PLAN-006/017)', () => {
  const guard = (orgId: number, key: Parameters<PlanUsageService['assertCanAdd']>[1]) =>
    h.app.get(PlanUsageService).assertCanAdd(orgId, key);

  it('counts what the workspace holds with the usage panel’s predicate and blocks row N+1', async () => {
    await paidPlan('tiny', '10', { limits: { tags: 2, pipelines: 0 } });
    const a = await signup();
    await setOrgState(a.orgId, 'tiny', null, null);
    await guard(a.orgId, 'tags');
    await h.owner.query(`INSERT INTO tags (org_id, name) VALUES ($1, 't1'), ($1, 't2')`, [a.orgId]);
    const err = await guard(a.orgId, 'tags').catch((e) => e);
    expect(err.code).toBe('PLAN_LIMIT_REACHED');
    expect(err.details).toContainEqual({ path: 'reason', message: 'limit_reached' });
    const usage = billingUsageResponseSchema.parse((await as(a, 'get', '/v2/billing/usage')).body);
    expect(usage.meters.find((m) => m.key === 'tags')).toMatchObject({ used: 2, limit: 2 });
    await guard(a.orgId, 'pipelines'); // unlimited
  });

  it('applies the workspace’s own override, and refuses the two keys that are not live counts', async () => {
    await paidPlan('tiny', '10', { limits: { tags: 1 } });
    const a = await signup();
    await setOrgState(a.orgId, 'tiny', null, null);
    await h.owner.query(`INSERT INTO tags (org_id, name) VALUES ($1, 't1')`, [a.orgId]);
    expect((await guard(a.orgId, 'tags').catch((e) => e)).code).toBe('PLAN_LIMIT_REACHED');
    const before = workspacePlanSchema.parse((await ops('get', `/workspace-plans/${a.uuid}`)).body);
    await ops('put', `/workspace-plans/${a.uuid}`).send({
      planSlug: 'tiny',
      rowVersion: before.rowVersion,
      overrides: { limits: { tags: 5 }, features: {} },
    });
    await guard(a.orgId, 'tags');
    await expect(guard(a.orgId, 'total_campaigns')).rejects.toThrow(/does not apply/);
    await expect(guard(a.orgId, 'monthly_messages')).rejects.toThrow(/does not apply/);
  });
});

describe('everything is configurable from the super admin panel (per plan, overridable per workspace)', () => {
  it('edits the platform yearly switch and discount; checkout, the picker and the public page follow', async () => {
    await paidPlan('pro', '100');
    const a = await signup();
    expect((await ops('get', '/plan-settings')).body).toEqual({
      yearlyToggleEnabled: true,
      yearlyDiscountPct: 20,
    });

    const saved = await ops('put', '/plan-settings').send({
      yearlyToggleEnabled: true,
      yearlyDiscountPct: 10,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const view = billingPlansResponseSchema.parse((await as(a, 'get', '/v2/billing/plans')).body);
    expect(view.yearlyToggle).toEqual({ enabled: true, discountPct: 10 });
    expect(view.data.find((p) => p.slug === 'pro')?.yearly).toEqual({
      perMonth: '90.00',
      perYear: '1080.00',
    });
    const pub = await api().get('/v2/public/cms/pricing');
    expect(pub.body.yearlyDiscountPct).toBe(10);
    expect(pub.body.plans[0].limits).toBeDefined();

    await ops('put', '/plan-settings').send({ yearlyToggleEnabled: false, yearlyDiscountPct: 10 });
    const off = billingPlansResponseSchema.parse((await as(a, 'get', '/v2/billing/plans')).body);
    expect(off.yearlyToggle.enabled).toBe(false);

    expect(
      (
        await ops('put', '/plan-settings', supportToken).send({
          yearlyToggleEnabled: true,
          yearlyDiscountPct: 20,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await ops('put', '/plan-settings').send({
          yearlyToggleEnabled: true,
          yearlyDiscountPct: 91,
        })
      ).status,
    ).toBe(422);
    expect((await ops('get', '/plan-settings', supportToken)).status).toBe(200);
    const ev = await h.owner.query(
      `SELECT 1 FROM security_events WHERE event = 'platform.plan.settings_updated'`,
    );
    expect(ev.rows.length).toBeGreaterThanOrEqual(2);
    await ops('put', '/plan-settings').send({ yearlyToggleEnabled: true, yearlyDiscountPct: 20 });
  });

  it('sets a workspace’s trial end from the console: extends it, or ends it now; a changed plan keeps an explicit date', async () => {
    await freePlan('free_trialops');
    await paidPlan('pro', '49');
    const a = await signup();
    await setOrgState(a.orgId, 'free_trialops', new Date(Date.now() + 2 * DAY), null);
    const w = workspacePlanSchema.parse((await ops('get', `/workspace-plans/${a.uuid}`)).body);
    const later = new Date(Date.now() + 30 * DAY).toISOString();
    const extended = await ops('put', `/workspace-plans/${a.uuid}`).send({
      planSlug: 'free_trialops',
      trialEndsAt: later,
      rowVersion: w.rowVersion,
    });
    expect(extended.status, JSON.stringify(extended.body)).toBe(200);
    expect(extended.body.validity).toMatchObject({ state: 'free_trial', trialEndsAt: later });

    const ended = await ops('put', `/workspace-plans/${a.uuid}`).send({
      planSlug: 'free_trialops',
      trialEndsAt: null,
      rowVersion: extended.body.rowVersion,
    });
    expect(ended.body.validity.state).toBe('free');
    expect((await as(a, 'get', '/v2/contacts')).status).toBe(200);

    // A workspace whose first request comes after the operator expires its trial is gated at once (an open verdict is cached for a few seconds).
    const b = await signup();
    await setOrgState(b.orgId, 'free_trialops', null, null);
    const wb = workspacePlanSchema.parse((await ops('get', `/workspace-plans/${b.uuid}`)).body);
    const past = new Date(Date.now() - DAY).toISOString();
    const expired = await ops('put', `/workspace-plans/${b.uuid}`).send({
      planSlug: 'free_trialops',
      trialEndsAt: past,
      rowVersion: wb.rowVersion,
    });
    expect(expired.body.validity.state).toBe('free_trial_expired');
    expect((await as(b, 'get', '/v2/contacts')).status).toBe(402);
  });

  it('overrides data retention for one workspace: longer, shorter, or never wipe it; the plan value applies otherwise', async () => {
    const mk = async (planSlug: string, lapsedDays: number) => {
      const a = await signup();
      await setOrgState(a.orgId, planSlug, null, new Date(Date.now() + 5 * DAY));
      await addContact(a, ++counter);
      await setOrgState(a.orgId, planSlug, null, new Date(Date.now() - lapsedDays * DAY));
      return a;
    };
    const setRetention = async (a: Account, days: number | null) => {
      const w = workspacePlanSchema.parse((await ops('get', `/workspace-plans/${a.uuid}`)).body);
      const res = await ops('put', `/workspace-plans/${a.uuid}`).send({
        planSlug: w.planSlug,
        planEndsAt: w.validity.planEndsAt,
        rowVersion: w.rowVersion,
        overrides: { limits: {}, features: {}, dataRetentionDays: days },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.overrides.dataRetentionDays).toBe(days);
    };
    const contacts = async (a: Account) =>
      (await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [a.orgId]))
        .rows[0].n as number;

    await paidPlan('ret_plan', '30', { dataRetentionDays: 30 });
    const exempt = await mk('ret_plan', 100); // plan says wipe after 30, workspace says never
    const shorter = await mk('ret_plan', 10); // plan says 30 (not due), workspace says 7 (due)
    const longer = await mk('ret_plan', 40); // plan says 30 (due), workspace says 90 (not due)
    const byPlan = await mk('ret_plan', 40); // no override: plan's 30
    await setRetention(exempt, 0);
    await setRetention(shorter, 7);
    await setRetention(longer, 90);

    const res = await api()
      .post('/v2/platform/workspace-plans/retention/run')
      .set(bearer(superToken))
      .send({ dryRun: false, confirm: 'WIPE' });
    expect(res.status).toBe(200);
    expect(await contacts(exempt)).toBe(1);
    expect(await contacts(longer)).toBe(1);
    expect(await contacts(shorter)).toBe(0);
    expect(await contacts(byPlan)).toBe(0);
    const bad = await ops('put', `/workspace-plans/${exempt.uuid}`).send({
      planSlug: 'ret_plan',
      rowVersion: 99,
      overrides: { limits: {}, features: {}, dataRetentionDays: 4000 },
    });
    expect(bad.status).toBe(422);
  });

  it('applies a per-workspace limit and flag override on top of the plan for every enforcement, and clears them back to the plan', async () => {
    await paidPlan('plain', '10', { limits: { tags: 1 }, features: { analytics: false } });
    const a = await signup();
    await setOrgState(a.orgId, 'plain', null, null);
    await h.owner.query(`INSERT INTO tags (org_id, name) VALUES ($1, 't1')`, [a.orgId]);
    const guard = () => h.app.get(PlanUsageService).assertCanAdd(a.orgId, 'tags');
    expect((await guard().catch((e) => e)).code).toBe('PLAN_LIMIT_REACHED');

    let w = workspacePlanSchema.parse((await ops('get', `/workspace-plans/${a.uuid}`)).body);
    let res = await ops('put', `/workspace-plans/${a.uuid}`).send({
      planSlug: 'plain',
      rowVersion: w.rowVersion,
      overrides: { limits: { tags: 3 }, features: { analytics: true }, dataRetentionDays: null },
    });
    await guard();
    const usage = billingUsageResponseSchema.parse((await as(a, 'get', '/v2/billing/usage')).body);
    expect(usage.meters.find((m) => m.key === 'tags')?.limit).toBe(3);
    expect(usage.features.find((f) => f.key === 'analytics')?.enabled).toBe(true);

    res = await ops('put', `/workspace-plans/${a.uuid}`).send({
      planSlug: 'plain',
      rowVersion: res.body.rowVersion,
      overrides: { limits: {}, features: {}, dataRetentionDays: null },
    });
    expect(res.status).toBe(200);
    expect((await guard().catch((e) => e)).code).toBe('PLAN_LIMIT_REACHED');
    w = workspacePlanSchema.parse(res.body);
    expect(w.overrides).toEqual({ limits: {}, features: {}, dataRetentionDays: null });
  });
});

describe('route gate, paywall data and the per-plan API rate limit (WD-PLAN-019, 020, 022)', () => {
  it('refuses a gated route on a plan without the feature (reads too) and allows it once the plan has it', async () => {
    await paidPlan('no_analytics', '10', { features: { analytics: false } });
    await paidPlan('with_analytics', '20', { features: { analytics: true } });
    const a = await signup();
    await setOrgState(a.orgId, 'no_analytics', null, null);
    const locked = await as(a, 'get', '/v2/analytics/overview');
    expect(locked.status, JSON.stringify(locked.body)).toBe(422);
    expect(locked.body.code).toBe('PLAN_FEATURE_LOCKED');
    expect(JSON.stringify(locked.body)).toContain('analytics');
    await setOrgState(a.orgId, 'with_analytics', null, null);
    await h.owner.query(`UPDATE org_plan_state SET overrides = '{}'::jsonb WHERE org_id = $1`, [
      a.orgId,
    ]);
    const open = await as(a, 'get', '/v2/analytics/overview');
    expect(open.status, JSON.stringify(open.body)).not.toBe(422);
  });

  it('caps a workspace’s API keys by its plan; 0 falls back to the platform default; an override of -1 lifts it', async () => {
    await paidPlan('api_cap', '10', { limits: { api_rate_limit_per_minute: 2 } });
    await paidPlan('api_default', '20', { limits: { api_rate_limit_per_minute: 0 } });
    const a = await signup();
    await setOrgState(a.orgId, 'api_cap', null, null);
    const crypto = h.app.get(CryptoService);
    const signingSecret = 'sign-secret-for-test';
    const prefix = `pk_${randomUUID().slice(0, 8)}`;
    const secret = 'plain-secret';
    await h.owner.query(
      `INSERT INTO api_keys (org_id, name, key_prefix, key_hash, signing_secret_enc, scopes, rate_limit_per_minute)
       VALUES ($1, 'k', $2, $3, $4, '{}', 1000)`,
      [a.orgId, prefix, await argonHash(secret), crypto.encrypt(signingSecret)],
    );
    const call = () => {
      const path = `/public/v1/leads/${randomUUID()}`;
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = createHmac('sha256', signingSecret).update(`${ts}.GET.${path}.`).digest('hex');
      return api()
        .get(path)
        .set({
          authorization: `ApiKey ${prefix}.${secret}`,
          'x-timestamp': ts,
          'x-signature': sig,
        });
    };
    const first = await call();
    expect(first.status, JSON.stringify(first.body)).not.toBe(429);
    expect(first.headers['x-ratelimit-limit']).toBe('2');
    await call();
    const third = await call();
    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();

    await h.owner.query(
      `UPDATE org_plan_state SET overrides = jsonb_build_object('limits', jsonb_build_object('api_rate_limit_per_minute', -1)) WHERE org_id = $1`,
      [a.orgId],
    );
    await new Promise((r) => setTimeout(r, 5500)); // the entitlement read is cached for a few seconds
    expect((await call()).status).not.toBe(429);
  });

  it('answers the entitlement keys and narrows the plan list to plans that unlock a feature', async () => {
    await paidPlan('basic', '10', { sortOrder: 1, features: { analytics: false } });
    await paidPlan('plus', '30', { sortOrder: 2, features: { analytics: true } });
    const a = await signup();
    await setOrgState(a.orgId, 'basic', null, null);
    const ent = await as(a, 'get', '/v2/billing/entitlements');
    expect(ent.status, JSON.stringify(ent.body)).toBe(200);
    expect(ent.body.features).not.toContain('analytics');
    const unlock = await as(a, 'get', '/v2/billing/plans?unlocks=analytics');
    expect(billingPlansResponseSchema.parse(unlock.body).data.map((p) => p.slug)).toEqual(['plus']);
    expect((await as(a, 'get', '/v2/billing/plans?unlocks=bogus')).status).toBe(422);
  });
});

describe('plan analytics, financial and premium reports (WD-PLAN-024..027)', () => {
  it('serves the reports to a super admin only, in the default currency, and exports the same numbers as CSV', async () => {
    await freePlan('rep_free', { sortOrder: 1 });
    await paidPlan('rep_paid', '25', { sortOrder: 2 });
    const a = await signup();
    await setOrgState(a.orgId, 'rep_paid', null, new Date(Date.now() + 20 * DAY));

    for (const path of ['/plan-analytics', '/financial', '/premium', '/plan-analytics/export']) {
      expect((await ops('get', path, supportToken)).status, path).toBe(403);
    }
    const overview = await ops('get', '/plan-analytics?days=7');
    expect(overview.status, JSON.stringify(overview.body)).toBe(200);
    expect(overview.body.days).toBe(90);
    expect(typeof overview.body.currency).toBe('string');
    const fin = await ops('get', '/financial?window=nonsense');
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    const prem = await ops('get', '/premium');
    expect(prem.status, JSON.stringify(prem.body)).toBe(200);
    const csv = await ops('get', '/plan-analytics/export');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
  });
});
