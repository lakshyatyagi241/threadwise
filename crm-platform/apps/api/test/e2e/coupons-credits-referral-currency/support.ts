import { vi } from 'vitest';
import { paygwGatewayListResponseSchema, type PaygwGatewayItem } from '@crm/contracts';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { CurrencyService } from '../../../src/modules/platform-settings-branding-storage';
import {
  newTenant,
  startBspHarness,
  type BspHarness,
  type Tenant,
} from '../bsp-billing-engine/harness';

export { newTenant, startBspHarness, type BspHarness, type Tenant };

/** Rows the CPN tests create are removed by their markers; every test names its data with these prefixes. */
export const TEST_COUPON_PREFIX = 'CPNT';
export const TEST_CURRENCY_CODES = ['CHF', 'QQQ', 'XTA', 'XTB', 'XTC', 'XTD', 'RUP', 'RUQ'];
export const TEST_PLAN_PREFIX = 'cpnt_';

/** Operator calls (every role reads, only super admin writes). */
export function ops(
  h: BspHarness,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  token = h.superToken,
) {
  return h.api
    .http()
    [method](`/v2/platform${path}`)
    .set({ authorization: `Bearer ${token}` });
}

/** A workspace member's call. */
export function as(
  h: BspHarness,
  token: string,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
) {
  return h.api
    .http()
    [method](`/v2/${path.replace(/^\//, '')}`)
    .set({ authorization: `Bearer ${token}` });
}

/** Writes a platform setting straight to the table, then drops the 5-second read snapshot. */
export async function setting(h: BspHarness, key: string, value: unknown) {
  await h.owner.query(
    `INSERT INTO platform_settings (key, value, is_secret) VALUES ($1, $2::jsonb, false)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
  h.app.get(PlatformSettingsService, { strict: false }).invalidate();
  h.app.get(CurrencyService, { strict: false }).flush();
}

export async function cleanCpn(h: BspHarness) {
  await h.owner.query(`DELETE FROM coupons WHERE code LIKE $1`, [`${TEST_COUPON_PREFIX}%`]);
  await h.owner.query(`DELETE FROM currencies WHERE code = ANY($1)`, [TEST_CURRENCY_CODES]);
  await h.owner.query(`DELETE FROM plans WHERE slug LIKE $1`, [`${TEST_PLAN_PREFIX}%`]);
}

const realFetch = globalThis.fetch;

/** Stripe's far end: one checkout session per order, read back by its id, always paid at the exact amount asked for. */
export function stripeThatPays() {
  const created = new Map<string, { ref: string; amount: number; currency: string }>();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, init);
    if (url.hostname !== 'api.stripe.com') throw new Error(`unexpected provider call ${url.href}`);
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (init?.method === 'POST') {
      const f = new URLSearchParams(String(init.body));
      const ref = f.get('client_reference_id')!;
      created.set(`cs_${ref}`, {
        ref,
        amount: Number(f.get('line_items[0][price_data][unit_amount]')),
        currency: f.get('line_items[0][price_data][currency]')!,
      });
      return json({ id: `cs_${ref}`, url: `https://checkout.stripe.com/c/cs_${ref}` });
    }
    const id = url.pathname.split('/').pop()!;
    const c = created.get(id)!;
    return json({
      id,
      url: `https://checkout.stripe.com/c/${id}`,
      client_reference_id: c.ref,
      payment_status: 'paid',
      payment_intent: `pi_${c.ref}`,
      amount_total: c.amount,
      currency: c.currency,
    });
  });
}

/** Configures and activates Stripe for the test; returns its gateway id. */
export async function activateStripe(h: BspHarness): Promise<string> {
  const list = paygwGatewayListResponseSchema.parse(
    (await ops(h, 'get', '/payment-gateways')).body,
  ).data;
  const g = list.find((x: PaygwGatewayItem) => x.slug === 'stripe')!;
  const cfg = await ops(h, 'patch', `/payment-gateways/${g.id}`).send({
    mode: 'sandbox',
    credentials: {
      secret_key: 'sk_test_cpn',
      publishable_key: 'pk_test_cpn',
      webhook_secret: 'whsec_cpn',
    },
    rowVersion: g.rowVersion,
  });
  if (cfg.status !== 200) throw new Error(`stripe config: ${JSON.stringify(cfg.body)}`);
  if (!g.isActive) {
    const act = await ops(h, 'post', `/payment-gateways/${g.id}/active`).send({
      isActive: true,
      rowVersion: cfg.body.rowVersion,
    });
    if (act.status >= 300) throw new Error(`stripe activate: ${JSON.stringify(act.body)}`);
  }
  return g.id;
}

/** The buyer comes back from Stripe: the order is confirmed and paid. */
export async function pay(h: BspHarness, orderNumber: string) {
  const o = await h.owner.query(`SELECT return_token FROM orders WHERE order_number = $1`, [
    orderNumber,
  ]);
  const res = await h.api
    .http()
    .get(`/v2/payments/return/stripe?o=${o.rows[0].return_token}&session_id=cs_${orderNumber}`)
    .redirects(0);
  if (res.status !== 303) throw new Error(`return answered ${res.status}`);
}
