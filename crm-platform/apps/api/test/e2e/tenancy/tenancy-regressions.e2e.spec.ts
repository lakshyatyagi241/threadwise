import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SubscriptionLifecycleService } from '../../../src/modules/platform-payment-gateways/subscription-lifecycle.service';
import { startHarness, type Harness } from '../auth-registration-security/harness';

/**
 * Regressions from the multi-tenancy isolation audit (tools/tenancy-audit). Each test names the finding it pins.
 * Real Postgres and the real AppModule; the denial is checked in the database, not only in the return value.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());

let ipCounter = 120;
async function signup(label: string): Promise<number> {
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', `10.8.0.${ipCounter++}`)
    .send({
      orgName: `Tenancy ${label}`,
      fullName: 'Tenancy Person',
      email: `${label}${Date.now()}@example.test`,
      password: 'Str0ngPassw0rd#1',
      acceptTerms: true,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const session = await api()
    .get('/v2/auth/session')
    .set({ authorization: `Bearer ${res.body.tokens.accessToken as string}` });
  const row = await h.owner.query(`SELECT id FROM organizations WHERE slug = $1`, [
    session.body.org.slug,
  ]);
  return Number(row.rows[0].id);
}

beforeAll(async () => {
  h = await startHarness();
}, 900_000);

afterAll(async () => {
  await h?.stop();
});

describe('TI-009: a provider event that names only a plan must not pick a workspace', () => {
  const addSub = async (orgId: number, gatewayPlanId: string, subId: string) => {
    await h.owner.query(
      `INSERT INTO subscriptions (org_id, plan_id, kind, gateway, gateway_subscription_id, gateway_plan_id, billing_cycle, status, amount, currency)
       VALUES ($1, 'growth', 'plan', 'razorpay', $2, $3, 'monthly', 'active', 999, 'INR')`,
      [orgId, subId, gatewayPlanId],
    );
  };
  const statusOf = async (subId: string) =>
    (
      await h.owner.query(`SELECT status FROM subscriptions WHERE gateway_subscription_id = $1`, [
        subId,
      ])
    ).rows[0].status as string;
  const cancelByPlan = (gatewayPlanId: string) =>
    h.app.get(SubscriptionLifecycleService).apply('razorpay', {
      type: 'canceled',
      subscriptionId: null,
      orderNumber: null,
      gatewayPlanId,
    } as never);

  it('matches nothing when two workspaces share the plan, and changes neither', async () => {
    const a = await signup('planA');
    const b = await signup('planB');
    await addSub(a, 'plan_shared_ti009', 'sub_ti009_a');
    await addSub(b, 'plan_shared_ti009', 'sub_ti009_b');

    expect(await cancelByPlan('plan_shared_ti009')).toBe('no_match');
    expect(await statusOf('sub_ti009_a')).toBe('active');
    expect(await statusOf('sub_ti009_b')).toBe('active');
  });

  it('still matches when exactly one subscription is on the plan (the legitimate fallback)', async () => {
    const c = await signup('planC');
    await addSub(c, 'plan_unique_ti009', 'sub_ti009_c');

    expect(await cancelByPlan('plan_unique_ti009')).toBe('canceled');
    expect(await statusOf('sub_ti009_c')).toBe('canceled');
  });
});
