import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workspaceHubDetailSchema, workspaceHubListResponseSchema } from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * The operator Workspaces hub through HTTP (WD-WSP-023/025): real Postgres through the real PlatformStore door. Workspaces, users,
 * wallets and messages are arranged with the owner connection (other domains own them); everything asserted goes through HTTP.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let superToken = '';
let supportToken = '';
let auditorToken = '';
const ids: Record<string, { id: number; uuid: string }> = {};

async function operatorToken(email: string, role: 'support' | 'auditor'): Promise<string> {
  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role)
     SELECT $1, $2, password_hash, $3 FROM platform_operators WHERE email = $4 ON CONFLICT DO NOTHING`,
    [email, `${role} operator`, role, OPERATOR_EMAIL],
  );
  const res = await api()
    .post('/v2/platform/auth/login')
    .send({ email, password: OPERATOR_PASSWORD });
  return res.body.tokens.accessToken as string;
}

async function org(slug: string, name: string, plan: string, ago: string, currency?: string) {
  const r = await h.owner.query(
    `INSERT INTO organizations (slug, name, plan, created_at, settings)
     VALUES ($1, $2, $3, now() - $4::interval, $5::jsonb) RETURNING id, uuid`,
    [slug, name, plan, ago, JSON.stringify(currency ? { currency } : {})],
  );
  ids[slug] = { id: Number(r.rows[0].id), uuid: r.rows[0].uuid as string };
}

async function owner(slug: string, name: string, email: string, viaSettings: boolean) {
  const orgId = ids[slug]!.id;
  const u = await h.owner.query(
    `INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id, uuid`,
    [orgId, email, name],
  );
  if (!viaSettings)
    await h.owner.query(
      `INSERT INTO workspace_settings (org_id, owner_user_id) VALUES ($1, $2) ON CONFLICT (org_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id`,
      [orgId, u.rows[0].id],
    );
  if (viaSettings)
    await h.owner.query(
      `UPDATE organizations SET settings = settings || jsonb_build_object('ownerUserId', $2::text) WHERE id = $1`,
      [orgId, u.rows[0].uuid],
    );
  await h.owner.query(
    `INSERT INTO user_profiles (org_id, user_id, phone_e164) VALUES ($1, $2, '+919876543210')`,
    [orgId, u.rows[0].id],
  );
}

async function messages(slug: string, n: number, status: string, ago = '1 hour') {
  const orgId = ids[slug]!.id;
  const ch = await h.owner.query(
    `INSERT INTO channels (org_id, kind, name, status) VALUES ($1, 'whatsapp', 'WA', 'connected') RETURNING id`,
    [orgId],
  );
  const cv = await h.owner.query(
    `INSERT INTO conversations (org_id, channel_id, peer_key, title, msg_seq) VALUES ($1, $2, $3, 'T', $4) RETURNING id`,
    [orgId, ch.rows[0].id, `9100${orgId}${n}`, n],
  );
  for (let i = 1; i <= n; i++)
    await h.owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, created_at)
       VALUES ($1, $2, $3, 'out', 'text', 'agent', $4, now() - $5::interval)`,
      [orgId, cv.rows[0].id, i, status, ago],
    );
}

const list = (token: string, qs = '') =>
  api().get(`/v2/platform/workspaces${qs}`).set(bearer(token));
const rowOf = async (slug: string) => {
  const res = await list(superToken, `?q=${slug}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return workspaceHubListResponseSchema.parse(res.body).data.find((r) => r.slug === slug)!;
};

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
  supportToken = await operatorToken('support@platform.test', 'support');
  auditorToken = await operatorToken('auditor@platform.test', 'auditor');

  await h.owner.query(
    `INSERT INTO plans (slug, name, kind, amount, currency, billing_unit, billing_duration, is_free, limits)
     VALUES ('hub_pro', 'Hub Pro', 'plan', 120, 'USD', 'years', 1, false, '{"users": 5, "monthly_messages": 1000}'::jsonb),
            ('hub_free', 'Hub Free', 'plan', 0, 'USD', 'months', 1, true, '{"users": 1}'::jsonb)
     ON CONFLICT (slug) DO NOTHING`,
  );
  await org('hub-alpha', 'Hub Alpha', 'hub_pro', '30 days');
  await org('hub-beta', 'Hub Beta', 'hub_free', '2 days');
  await org('hub-gamma', 'Hub Gamma', 'hub_free', '60 days');
  await owner('hub-alpha', 'Alice Owner', 'alice@hub.test', true);
  await owner('hub-beta', 'Bob Owner', 'bob@hub.test', false);
  // the paid workspace: period ahead, own limit override, a wallet below the low-balance line (0.20), 12 delivered + 3 failed messages
  await h.owner.query(
    `INSERT INTO org_plan_state (org_id, plan_ends_at, billing_cycle, overrides)
     VALUES ($1, now() + interval '20 days', 'yearly', '{"limits": {"users": 25}, "features": {}}'::jsonb)
     ON CONFLICT (org_id) DO UPDATE SET plan_ends_at = EXCLUDED.plan_ends_at, overrides = EXCLUDED.overrides`,
    [ids['hub-alpha']!.id],
  );
  await h.owner.query(
    `INSERT INTO org_plan_state (org_id, trial_ends_at, billing_cycle)
     VALUES ($1, now() + interval '5 days', 'trial')
     ON CONFLICT (org_id) DO UPDATE SET trial_ends_at = EXCLUDED.trial_ends_at`,
    [ids['hub-beta']!.id],
  );
  await h.owner.query(`INSERT INTO wallets (org_id, unit, balance) VALUES ($1, 'USD', 0.15)`, [
    ids['hub-alpha']!.id,
  ]);
  await h.owner.query(`INSERT INTO wallets (org_id, unit, balance) VALUES ($1, 'USD', 80)`, [
    ids['hub-beta']!.id,
  ]);
  await messages('hub-alpha', 12, 'delivered');
  await messages('hub-alpha', 3, 'failed');
  await h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number) VALUES ($1, 'waba', 'connected', '+911'), ($1, 'waba', 'pending', '+912')`,
    [ids['hub-alpha']!.id],
  );
  await h.owner.query(
    `INSERT INTO support_tickets (org_id, ticket_number, name, email, subject, message, status)
     VALUES ($1, 'HUB-1', 'n', 'e@x.test', 's', 'm', 'open'), ($1, 'HUB-2', 'n', 'e@x.test', 's', 'm', 'resolved')`,
    [ids['hub-alpha']!.id],
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('GET /v2/platform/workspaces', () => {
  it('needs an operator; every operator role with view_all reads it', async () => {
    expect((await api().get('/v2/platform/workspaces')).status).toBe(401);
    for (const t of [superToken, supportToken, auditorToken])
      expect((await list(t)).status).toBe(200);
  });

  it('lists every workspace with the contract shape, newest first, and the KPIs and filters', async () => {
    const res = await list(superToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const b = workspaceHubListResponseSchema.parse(res.body);
    const slugs = b.data.map((r) => r.slug);
    expect(slugs.filter((s) => s.startsWith('hub-'))).toEqual([
      'hub-beta',
      'hub-alpha',
      'hub-gamma',
    ]);
    expect(b.kpis.total).toBeGreaterThanOrEqual(3);
    expect(b.kpis.trial).toBe(1);
    expect(b.kpis.lowBalance).toBeGreaterThanOrEqual(2); // alpha (0.15) and gamma (no wallet)
    expect(b.kpis.newThisMonth).toBeGreaterThanOrEqual(1);
    expect(b.kpis.mrr).toBe('10.00');
    expect(b.filters.plans.map((p) => p.slug)).toEqual(
      expect.arrayContaining(['hub_pro', 'hub_free']),
    );
    expect(b.filters.providers.length).toBeGreaterThan(0);
  });

  it('one row carries plan, validity, limits, wallet, owner, numbers, messages and health', async () => {
    const a = await rowOf('hub-alpha');
    expect(a.plan).toMatchObject({
      slug: 'hub_pro',
      name: 'Hub Pro',
      known: true,
      platformOwned: false,
    });
    expect(a.validity.state).toBe('paid_active');
    expect(a.limits).toMatchObject({ users: 25, monthlyMessages: 1000, overridden: true });
    expect(a.wallet).toEqual({ currency: 'USD', balanceMinor: '15', low: true });
    expect(a.owner).toMatchObject({
      name: 'Alice Owner',
      email: 'alice@hub.test',
      phone: '+919876543210',
    });
    expect(a.numbers).toBe(1);
    expect(a.messages7d).toBe(15);
    expect(a.lastActiveAt).not.toBeNull();
    expect(a.mrr).toBe('10.00');
    expect(a.health).toBe('low');
    expect(a.provider.source).toMatch(/default|platform_setting/);

    const b = await rowOf('hub-beta');
    expect(b.validity.state).toBe('free_trial');
    expect(b.health).toBe('new');
    expect(b.wallet.low).toBe(false);
    expect(b.mrr).toBe('0.00');
    expect(b.owner?.email).toBe('bob@hub.test'); // named by workspace_settings.owner_user_id
  });

  it('filters: q (name, owner email), plan, state, status, lowBalanceOnly, provider', async () => {
    const slugsOf = async (qs: string) => {
      const res = await list(superToken, qs);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.data as Array<{ slug: string }>)
        .map((r) => r.slug)
        .filter((s) => s.startsWith('hub-'));
    };
    expect(await slugsOf('?q=Hub%20Alp')).toEqual(['hub-alpha']);
    expect(await slugsOf('?q=alice@hub')).toEqual(['hub-alpha']);
    expect(await slugsOf('?plan=hub_free')).toEqual(['hub-beta', 'hub-gamma']);
    expect(await slugsOf('?state=free_trial')).toEqual(['hub-beta']);
    expect(await slugsOf('?state=paid_active')).toEqual(['hub-alpha']);
    expect(await slugsOf('?status=suspended&q=hub-')).toEqual([]);
    expect(await slugsOf('?lowBalanceOnly=true')).toEqual(['hub-alpha', 'hub-gamma']);
    const a = await rowOf('hub-alpha');
    expect(await slugsOf(`?provider=${a.provider.key}&q=hub-alpha`)).toEqual(['hub-alpha']);
    expect(await slugsOf('?provider=no-such-provider&q=hub-')).toEqual([]);
    expect((await list(superToken, '?plan=')).status).toBe(422);
    expect((await list(superToken, '?sort=banana')).status).toBe(422);
  });

  it('keyset pagination walks every sort order without gaps or repeats', async () => {
    for (const sort of ['created', 'name', 'last_active'] as const) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 50; guard++) {
        const res = await list(
          superToken,
          `?sort=${sort}&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        );
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const b = workspaceHubListResponseSchema.parse(res.body);
        expect(b.data.length).toBeLessThanOrEqual(1);
        seen.push(...b.data.map((r) => r.slug));
        if (!b.page.hasMore) {
          expect(b.page.nextCursor).toBeNull();
          break;
        }
        cursor = b.page.nextCursor;
        expect(cursor).not.toBeNull();
      }
      const full = (await list(superToken, `?sort=${sort}&limit=100`)).body.data.map(
        (r: { slug: string }) => r.slug,
      );
      expect(seen).toEqual(full);
      expect(new Set(seen).size).toBe(seen.length);
    }
    const byActivity = (await list(superToken, '?sort=last_active&limit=100')).body.data.map(
      (r: { slug: string }) => r.slug,
    );
    expect(byActivity.indexOf('hub-alpha')).toBeLessThan(byActivity.indexOf('hub-beta')); // alpha sent messages, beta never
    const byName = (await list(superToken, '?sort=name&limit=100')).body.data.map(
      (r: { slug: string }) => r.slug,
    );
    expect(byName.indexOf('hub-alpha')).toBeLessThan(byName.indexOf('hub-beta'));
  });

  it('a cursor made for another sort order is refused', async () => {
    const res = await list(superToken, '?limit=1');
    const cursor = res.body.page.nextCursor as string;
    expect((await list(superToken, `?sort=name&cursor=${cursor}`)).status).toBe(422);
    expect((await list(superToken, '?cursor=garbage')).status).toBe(422);
  });
});

describe('GET /v2/platform/workspaces/:id', () => {
  it('the dashboard: counts, 30 zero-filled days, delivered share, note and the caller can-flags', async () => {
    await h.owner.query(`UPDATE workspace_settings SET admin_note = 'VIP' WHERE org_id = $1`, [
      ids['hub-alpha']!.id,
    ]);
    await h.owner.query(
      `INSERT INTO workspace_settings (org_id, admin_note) VALUES ($1, 'VIP') ON CONFLICT (org_id) DO UPDATE SET admin_note = 'VIP'`,
      [ids['hub-alpha']!.id],
    );
    const res = await api()
      .get(`/v2/platform/workspaces/${ids['hub-alpha']!.uuid}`)
      .set(bearer(superToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = workspaceHubDetailSchema.parse(res.body);
    expect(d.row.slug).toBe('hub-alpha');
    expect(d.members).toBe(1);
    expect(d.openTickets).toBe(1);
    expect(d.messages30d).toHaveLength(30);
    expect(d.messages30d.reduce((a, x) => a + x.sent, 0)).toBe(15);
    expect(d.messages30d.reduce((a, x) => a + x.delivered, 0)).toBe(12);
    expect(d.deliveredPct).toBe(80);
    expect(d.adminNote).toBe('VIP');
    expect(d.can).toEqual({
      suspend: true,
      unsuspend: true,
      impersonate: true,
      editPlan: true,
      manageProvider: true,
      adjustWallet: true,
    });

    const sup = await api()
      .get(`/v2/platform/workspaces/${ids['hub-alpha']!.uuid}`)
      .set(bearer(supportToken));
    expect(sup.body.can).toMatchObject({
      suspend: false,
      editPlan: false,
      adjustWallet: false,
      impersonate: true,
    });
  });

  it('an unknown workspace is 404 and a malformed id is 400', async () => {
    expect(
      (
        await api()
          .get('/v2/platform/workspaces/00000000-0000-4000-8000-000000000000')
          .set(bearer(superToken))
      ).status,
    ).toBe(404);
    expect((await api().get('/v2/platform/workspaces/nope').set(bearer(superToken))).status).toBe(
      422,
    );
  });
});

describe('suspend and unsuspend', () => {
  it('support cannot suspend; super admin suspends and lifts, and the hub row follows', async () => {
    const u = ids['hub-gamma']!.uuid;
    expect(
      (
        await api()
          .post(`/v2/platform/workspaces/${u}/suspend`)
          .set(bearer(supportToken))
          .send({ reason: 'x' })
      ).status,
    ).toBe(403);

    const s = await api()
      .post(`/v2/platform/workspaces/${u}/suspend`)
      .set(bearer(superToken))
      .send({ reason: 'Chargeback' });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body).toMatchObject({
      slug: 'hub-gamma',
      status: 'suspended',
      suspendedBy: ['frozen'],
      health: 'suspended',
    });
    const filtered = await list(superToken, '?status=suspended');
    expect(filtered.body.data.map((r: { slug: string }) => r.slug)).toContain('hub-gamma');
    expect(filtered.body.kpis.suspended).toBeGreaterThanOrEqual(1);

    const l = await api().post(`/v2/platform/workspaces/${u}/unsuspend`).set(bearer(superToken));
    expect(l.status, JSON.stringify(l.body)).toBe(200);
    expect(l.body).toMatchObject({ status: 'active', suspendedBy: [] });
    const events = await h.owner.query(
      `SELECT event FROM security_events WHERE subject_org_id = $1 AND event LIKE 'platform.inbox.%' ORDER BY id`,
      [ids['hub-gamma']!.id],
    );
    expect(events.rows.length).toBeGreaterThanOrEqual(2);
  });
});
