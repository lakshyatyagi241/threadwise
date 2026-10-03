import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAnalyticsSchema, adminOverviewSchema } from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * The operator overview and analytics end to end (WD-DASH-034..044): real Postgres through the real PlatformStore door. Orders,
 * users and devices are arranged with the owner connection (other domains own them); everything asserted goes through HTTP.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let superToken = '';
let supportToken = '';
let alpha = 0;
let beta = 0;

async function org(slug: string, name: string, plan: string): Promise<number> {
  const r = await h.owner.query(
    `INSERT INTO organizations (slug, name, plan) VALUES ($1, $2, $3) RETURNING id`,
    [slug, name, plan],
  );
  return Number(r.rows[0].id);
}
async function order(
  orgId: number,
  n: string,
  status: string,
  amount: number,
  gateway: string | null,
  ago: string,
  failure: string | null = null,
) {
  await h.owner.query(
    `INSERT INTO orders (org_id, order_number, status, amount, total_amount, currency, gateway_slug, kind, plan_slug, paid_at, created_at, failure_reason)
     VALUES ($1, $2, $3, $4, $4, 'USD', $5, 'plan', 'pro_m', CASE WHEN $3 = 'paid' THEN now() - $6::interval END, now() - $6::interval, $7)`,
    [orgId, n, status, amount, gateway, ago, failure],
  );
}

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: hotp(base32Decode(setup.body.secret), totpStep(Date.now())) });
  superToken = token;
  const sup = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;

  await h.owner.query(
    `INSERT INTO plans (slug, name, kind, amount, currency, billing_unit, billing_duration, is_free)
     VALUES ('pro_m', 'Pro', 'plan', 120, 'USD', 'years', 1, false) ON CONFLICT (slug) DO NOTHING`,
  );
  alpha = await org('alpha', 'Alpha Co', 'pro_m');
  beta = await org('beta', 'Beta Co', 'free');
  await order(alpha, 'O-1', 'paid', 600, 'stripe', '1 day');
  await order(alpha, 'O-2', 'paid', 300, 'razorpay', '2 days');
  await order(beta, 'O-3', 'paid', 100, 'paypal', '3 days');
  await order(beta, 'O-4', 'paid', 50, 'cashfree', '3 days');
  await order(beta, 'O-5', 'failed', 10, 'stripe', '1 hour', 'Card declined.');
  await order(alpha, 'O-6', 'paid', 800, 'stripe', '10 days'); // previous 7d window
  for (const [orgId, email] of [
    [alpha, 'a@x.test'],
    [beta, 'b@x.test'],
  ] as const) {
    await h.owner.query(`INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)`, [
      orgId,
      email,
      `Owner ${email}`,
    ]);
  }
  const owner = await h.owner.query(`SELECT id FROM users WHERE org_id = $1`, [alpha]);
  await h.owner.query(
    `INSERT INTO workspace_settings (org_id, owner_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [alpha, owner.rows[0].id],
  );
  await h.owner.query(
    `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active, sent_24h)
     VALUES ($1, 'Main', '91', '9876543210', 'connected', true, 12), ($1, 'Spare', '91', '9000000000', 'disconnected', false, 0)`,
    [alpha],
  );
  await h.owner.query(
    `INSERT INTO support_tickets (org_id, ticket_number, name, email, subject, message, status)
     VALUES ($1, 'T-1', 'n', 'e@x.test', 's', 'm', 'open'), ($1, 'T-2', 'n', 'e@x.test', 's', 'm', 'resolved')`,
    [alpha],
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('GET /v2/platform/dashboard/overview', () => {
  it('needs an operator and refuses support (money)', async () => {
    expect((await api().get('/v2/platform/dashboard/overview')).status).toBe(401);
    expect(
      (await api().get('/v2/platform/dashboard/overview').set(bearer(supportToken))).status,
    ).toBe(403);
  });

  it('income, profit estimate and the delta against the previous window (7d default)', async () => {
    const res = await api().get('/v2/platform/dashboard/overview').set(bearer(superToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const b = adminOverviewSchema.parse(res.body);
    expect(b.window).toBe('7d');
    expect(b.kpis.income).toEqual({ value: '1050.00', previous: '800.00', changePct: '31.25' });
    expect(b.kpis.profit.value).toBe('336.00'); // 32% placeholder margin
    expect(b.kpis.conversion.value).toBe('100.00'); // 2 paying workspaces / 2 signups
  });

  it('an unknown window falls back to 7d; 30d uses the whole 30-day span', async () => {
    const odd = await api()
      .get('/v2/platform/dashboard/overview?window=banana')
      .set(bearer(superToken));
    expect(odd.body.window).toBe('7d');
    const res = await api()
      .get('/v2/platform/dashboard/overview?window=30d')
      .set(bearer(superToken));
    const b = adminOverviewSchema.parse(res.body);
    expect(b.kpis.income.value).toBe('1850.00');
    // deliberate fix: the revenue chart covers the whole window, so its total equals the income card
    expect(b.revenue.total).toBe(b.kpis.income.value);
    expect(b.revenue.target.every((t) => t >= 100)).toBe(true);
  });

  it('the revenue chart has one point per day for 7d', async () => {
    const res = await api()
      .get('/v2/platform/dashboard/overview?window=7d')
      .set(bearer(superToken));
    expect(res.body.revenue.series).toHaveLength(7);
    expect(res.body.revenue.labels).toHaveLength(7);
  });

  it('gateway donut: top three by revenue and the rest as Other', async () => {
    const res = await api()
      .get('/v2/platform/dashboard/overview?window=7d')
      .set(bearer(superToken));
    expect(res.body.gateways).toEqual([
      { gateway: 'Stripe', amount: '600.00' },
      { gateway: 'Razorpay', amount: '300.00' },
      { gateway: 'Paypal', amount: '100.00' },
      { gateway: 'Other', amount: '50.00' },
    ]);
  });

  it('registered users gauge counts owners of a paid-plan workspace', async () => {
    const res = await api().get('/v2/platform/dashboard/overview').set(bearer(superToken));
    expect(res.body.users).toEqual({ total: 2, premium: 1, basic: 1, pct: 50 });
  });

  it('workspace table: owner, plan, monthly-normalised MRR, Idle with no messages', async () => {
    const res = await api().get('/v2/platform/dashboard/overview').set(bearer(superToken));
    const a = res.body.workspaces.find((w: { slug: string }) => w.slug === 'alpha');
    expect(a).toMatchObject({ name: 'Alpha Co', plan: 'Pro', health: 'idle', mrr: '10.00' });
    expect(a.owner).toBe('Owner a@x.test');
  });

  it('alerts: the failed payment is high', async () => {
    const res = await api().get('/v2/platform/dashboard/overview').set(bearer(superToken));
    expect(res.body.alerts.open).toBe(1);
    expect(res.body.alerts.items[0]).toEqual({
      severity: 'high',
      title: 'Beta Co payment failed',
      detail: 'Card declined.',
    });
  });

  it('a pending review and a message spike join the queue (the header counts them all)', async () => {
    await h.owner.query(`UPDATE organizations SET status = 'pending' WHERE id = $1`, [beta]);
    const channel = await h.owner.query(
      `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'simulator', 'sim') RETURNING id`,
      [alpha],
    );
    const conv = await h.owner.query(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1, $2, 'p', 'c') RETURNING id`,
      [alpha, channel.rows[0].id],
    );
    // 40 sends in the last hour on top of a 800-in-the-week base: about 7.6x the hourly average
    await h.owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, kind, created_at)
       SELECT $1, $2, g, 'out', 'agent', 'sent', 'text', now() - interval '10 minutes' FROM generate_series(1, 40) g`,
      [alpha, conv.rows[0].id],
    );
    await h.owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, kind, created_at)
       SELECT $1, $2, 100 + g, 'out', 'agent', 'sent', 'text', now() - interval '3 days' FROM generate_series(1, 800) g`,
      [alpha, conv.rows[0].id],
    );
    const res = await api().get('/v2/platform/dashboard/overview').set(bearer(superToken));
    expect(res.body.alerts.open).toBe(3);
    const titles = res.body.alerts.items.map((i: { title: string }) => i.title);
    expect(titles).toContain('Alpha Co message spike');
    expect(titles).toContain('1 workspace review pending');
    const spike = res.body.alerts.items.find((i: { severity: string }) => i.severity === 'medium');
    expect(spike.detail).toMatch(/^\d+\.\dx normal hourly volume\.$/);
    expect(res.body.kpis.views.value).toBe('840');
    const a = res.body.workspaces.find((w: { slug: string }) => w.slug === 'alpha');
    expect(a.health).toBe('good');
  });
});

describe('GET /v2/platform/dashboard/analytics', () => {
  it('clamps days to 1..365 and defaults to 30', async () => {
    const big = await api()
      .get('/v2/platform/dashboard/analytics?days=5000')
      .set(bearer(superToken));
    expect(big.body.days).toBe(365);
    const dflt = await api().get('/v2/platform/dashboard/analytics').set(bearer(superToken));
    expect(dflt.body.days).toBe(30);
  });

  it('KPI strip, devices online, tickets, zero-filled signups and leaderboard', async () => {
    const res = await api().get('/v2/platform/dashboard/analytics?days=7').set(bearer(superToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const b = adminAnalyticsSchema.parse(res.body);
    expect(b.kpis).toMatchObject({
      revenue: '1050.00',
      workspaces: 2,
      newWorkspaces: 2,
      users: 2,
      newUsers: 2,
      devicesOnline: 1,
      devicesTotal: 2,
      openTickets: 1,
    });
    expect(b.signups.length).toBeGreaterThanOrEqual(7);
    expect(b.signups.reduce((a, s) => a + s.count, 0)).toBe(2);
    expect(b.leaderboard[0]).toEqual({
      slug: 'alpha',
      name: 'Alpha Co',
      orders: 2,
      amount: '900.00',
    });
    expect(b.topDevices[0]).toEqual({ label: expect.stringContaining('Main'), sent24h: 12 });
    expect(b.deviceSends24h).toBe(12);
    expect(b.planMix.map((p) => p.plan).sort()).toEqual(['Pro', 'free']);
    expect(b.tickets).toContainEqual({ status: 'open', count: 1 });
  });

  it('exports the signups as CSV: a header plus a row per date with a signup, and audits it', async () => {
    const res = await api()
      .get('/v2/platform/dashboard/analytics/export?days=7')
      .set(bearer(superToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/analytics-signups-7d-\d{8}-\d{4}\.csv/);
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('date,signups');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2},2$/);
    const audit = await h.owner.query(
      `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.analytics.exported'`,
    );
    expect(audit.rows[0].n).toBe(1);
  });
});

/** Last in the file: it adds signups that the earlier counts must not see. */
describe('WD-DASH-037 admin overview geography', () => {
  it('no profile with a country shows the empty list and six zero regions', async () => {
    const b = adminOverviewSchema.parse(
      (await api().get('/v2/platform/dashboard/overview?window=30d').set(bearer(superToken))).body,
    );
    expect(b.countries).toEqual([]);
    expect(b.regions.map((r) => r.count)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('ranks the top four by signups with shares of those four; ISO and dial-prefix profiles both count', async () => {
    let i = 0;
    for (const [country, code, n] of [
      ['IN', '91', 3],
      [null, '91', 2], // WaDesk's dial prefix, no ISO country
      ['US', '1', 3],
      ['DE', '49', 1],
      ['GB', '44', 1],
    ] as const) {
      for (let k = 0; k < n; k++) {
        const u = await h.owner.query(
          `INSERT INTO users (org_id, email, full_name, created_at) VALUES ($1, $2, 'Geo', now() - interval '20 days') RETURNING id`,
          [alpha, `geo${i++}@x.test`],
        );
        await h.owner.query(
          `INSERT INTO user_settings (org_id, user_id, country, country_code) VALUES ($1, $2, $3, $4)`,
          [alpha, u.rows[0].id, country, code],
        );
      }
    }
    const res = await api()
      .get('/v2/platform/dashboard/overview?window=30d')
      .set(bearer(superToken));
    const b = adminOverviewSchema.parse(res.body);
    expect(b.countries).toEqual([
      { code: 'IN', name: 'India', count: 5, pct: '50.0' },
      { code: 'US', name: 'United States', count: 3, pct: '30.0' },
      { code: 'DE', name: 'Germany', count: 1, pct: '10.0' },
      { code: 'GB', name: 'United Kingdom', count: 1, pct: '10.0' },
    ]);
    const radar = Object.fromEntries(b.regions.map((r) => [r.region, r.count]));
    expect(radar).toMatchObject({ Asia: 5, Americas: 3, Europe: 2 });
  });
});
