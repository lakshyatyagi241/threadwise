import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { PlatformStore } from '../../../src/modules/auth';
import { SessionService } from '../../../src/modules/auth/sessions/session.service';
import { SecurityPolicyService } from '../../../src/modules/auth/platform/security-policy.service';
import { TokenService } from '../../../src/modules/auth/token.service';
import { CouponCheckoutService } from '../../../src/modules/coupons-credits-referral-currency';
import { ReferralCodeService } from '../../../src/modules/coupons-credits-referral-currency/referral-code.service';
import { ReferralRewardService } from '../../../src/modules/coupons-credits-referral-currency/referral-reward.service';
import { StorageMeterService } from '../../../src/modules/storage-quota/storage-meter.service';
import { StorageQuotaRepository } from '../../../src/modules/storage-quota/storage-quota.repository';
import {
  MessageBillingService,
  WalletLedgerService,
} from '../../../src/modules/wallet-message-billing';
import { OutboxDrainService } from '../../../src/workers/outbox-drain.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { ROUNDS, race, rng, sleep } from './support';

/**
 * QA Sheet3 #15, service side. The money, session, counter and outbox primitives, called in parallel the way two requests or two
 * workers would, against real Postgres. Scenarios: CC-WAL (wallet), CC-REF (referral), CC-CPN (coupons), CC-SES (sessions),
 * CC-STO (storage counters), CC-OBX (outbox drain), CC-INV (invoice numbers and payments).
 */
let h: Harness;
let api: Api;
let db: DatabaseService;
beforeAll(async () => {
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/coupons-credits-referral-currency'))
        .CouponsCreditsReferralCurrencyWorkerModule,
    ],
  });
  api = new Api(h);
  db = h.app.get(DatabaseService);
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

const q = (text: string, params: unknown[] = []) => h.owner.query(text, params);
const scalar = async (text: string, params: unknown[] = []) =>
  Number((await q(text, params)).rows[0].n);

// --- wallet ------------------------------------------------------------------------------------------------------------------------

describe('CC-WAL: wallet debits and top-ups', () => {
  const post = (
    orgId: number,
    over: {
      type: 'topup' | 'spend';
      direction: 'in' | 'out';
      amountMinor: number;
      key: string;
      allowPartial?: boolean;
    },
  ) =>
    db.txAs({ orgId, userId: null }, (tx) =>
      h.app.get(WalletLedgerService).post(tx, {
        orgId,
        unit: 'USD',
        type: over.type,
        direction: over.direction,
        amountMinor: over.amountMinor,
        idempotencyKey: over.key,
        allowPartial: over.allowPartial,
        source: 'conc',
      }),
    );
  const fund = (orgId: number, minor: number) =>
    post(orgId, {
      type: 'topup',
      direction: 'in',
      amountMinor: minor,
      key: `fund-${Math.random()}`,
    });
  const balance = async (orgId: number) =>
    scalar(
      `SELECT coalesce((SELECT (balance * 100)::bigint FROM wallets WHERE org_id = $1), 0) AS n`,
      [orgId],
    );
  const ledger = async (orgId: number) =>
    (
      await q(
        `SELECT (amount * 100)::bigint AS minor, (balance_after * 100)::bigint AS after
         FROM wallet_transactions WHERE org_id = $1 ORDER BY id`,
        [orgId],
      )
    ).rows.map((r) => ({
      signed: Number(r.minor),
      after: Number(r.after),
    }));

  it('CC-WAL-01 12 strict debits of 3.00 on 10.00: exactly 3 succeed, 9 get 409, no negative balance, ledger sums to balance', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const t = await api.signup('wal1');
      await fund(t.orgId, 1000);
      const res = await race(12, (i) =>
        post(t.orgId, {
          type: 'spend',
          direction: 'out',
          amountMinor: 300,
          key: `d${round}-${i}`,
        }).then(
          () => 'ok',
          (e: { code?: string }) => e.code ?? 'error',
        ),
      );
      expect(res.filter((r) => r === 'ok')).toHaveLength(3);
      expect(res.filter((r) => r === 'WALLET_INSUFFICIENT_BALANCE')).toHaveLength(9);
      expect(await balance(t.orgId)).toBe(100);
      const rows = await ledger(t.orgId);
      expect(rows.reduce((s, r) => s + r.signed, 0)).toBe(100);
      expect(rows.every((r) => r.after >= 0)).toBe(true);
    }
  });

  it('CC-WAL-02 the same top-up key sent 10 times at once credits once', async () => {
    const t = await api.signup('wal2');
    for (let round = 0; round < ROUNDS; round++) {
      const key = `topup-${round}`;
      const res = await race(10, () =>
        post(t.orgId, { type: 'topup', direction: 'in', amountMinor: 500, key }),
      );
      expect(res.filter((r) => !r.replayed)).toHaveLength(1);
      expect(new Set(res.map((r) => r.transactionId)).size).toBe(1);
      expect(await balance(t.orgId)).toBe(500 * (round + 1));
    }
  });

  it('CC-WAL-03 top-ups and debits interleaved: the balance equals the sum of what was applied and never dips below zero', async () => {
    const t = await api.signup('wal3');
    await fund(t.orgId, 2000);
    const res = await race(24, (i) =>
      i % 2 === 0
        ? post(t.orgId, { type: 'topup', direction: 'in', amountMinor: 700, key: `in-${i}` })
        : post(t.orgId, {
            type: 'spend',
            direction: 'out',
            amountMinor: 900,
            key: `out-${i}`,
            allowPartial: true,
          }),
    );
    const net = res.reduce((s, r, i) => s + (i % 2 === 0 ? r.appliedMinor : -r.appliedMinor), 2000);
    expect(await balance(t.orgId)).toBe(net);
    const rows = await ledger(t.orgId);
    expect(rows.reduce((s, r) => s + r.signed, 0)).toBe(net);
    expect(rows.every((r) => r.after >= 0)).toBe(true);
  });

  it('CC-WAL-04 delivery receipts for one message id, repeated in parallel, charge once; 10 more messages never overdraw the wallet', async () => {
    const t = await api.signup('wal4');
    await q(
      `INSERT INTO workspace_settings (org_id, bill_to_platform_credit) VALUES ($1, true)
       ON CONFLICT (org_id) DO UPDATE SET bill_to_platform_credit = true`,
      [t.orgId],
    );
    const billing = h.app.get(MessageBillingService);
    const settle = (id: string) =>
      billing.settleDelivered({
        orgId: t.orgId,
        provider: 'waba',
        providerMessageId: id,
        recipient: '+14155550100',
        category: 'marketing',
        source: 'campaign',
      });
    await fund(t.orgId, 4800);
    const same = await race(10, () => settle(`wamid.same.${t.orgId}`));
    const charged = same.filter((o) => o.status === 'charged');
    expect(charged, JSON.stringify(same)).toHaveLength(1);
    expect(same.filter((o) => o.status === 'replayed')).toHaveLength(9);
    expect(await balance(t.orgId)).toBe(
      4800 - (charged[0] as { chargedMinor: number }).chargedMinor,
    );
    const many = await race(10, (i) => settle(`wamid.many.${t.orgId}.${i}`));
    expect(many.filter((o) => o.status === 'charged').length).toBeGreaterThan(0);
    expect(await balance(t.orgId)).toBeGreaterThanOrEqual(0);
    const rows = await ledger(t.orgId);
    expect(rows.reduce((s, r) => s + r.signed, 0)).toBe(await balance(t.orgId));
    expect(rows.every((r) => r.after >= 0)).toBe(true);
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM usage_charges WHERE org_id = $1 AND wamid = $2`,
        [t.orgId, `wamid.same.${t.orgId}`],
      ),
    ).toBe(1);
  });
});

// --- referral and coupons -----------------------------------------------------------------------------------------------------------

describe('CC-REF: referral reward and codes', () => {
  it('CC-REF-01 the reward for one referral, triggered 8 times at once, is paid once', async () => {
    const referrer = await api.signup('refa');
    const referee = await api.signup('refb');
    await q(
      `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used)
       VALUES ($1, $2, $3, $4, 'CONC1')`,
      [referrer.orgId, referrer.adminUserId, referee.orgId, referee.adminUserId],
    );
    const svc = h.app.get(ReferralRewardService, { strict: false });
    const res = await race(8, () => svc.rewardFirstPayment(referee.orgId));
    const paid = res.filter((r) => r.status === 'paid');
    expect(paid, JSON.stringify(res)).toHaveLength(1);
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM wallet_transactions WHERE org_id = $1 AND idempotency_key LIKE 'referral:%'`,
        [referrer.orgId],
      ),
    ).toBe(1);
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM referrals WHERE referred_org_id = $1 AND award_transaction_id IS NOT NULL`,
        [referee.orgId],
      ),
    ).toBe(1);
  });

  it('CC-REF-02 one user asking for a code 8 times at once gets one code; 8 users get 8 different codes', async () => {
    const t = await api.signup('refc');
    const svc = h.app.get(ReferralCodeService, { strict: false });
    const same = await race(8, () => svc.ensure(t.orgId, t.adminUserId));
    expect(new Set(same).size).toBe(1);
    expect(
      await scalar(`SELECT count(*)::int AS n FROM referral_codes WHERE owner_org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(1);
    const tenants = await Promise.all(Array.from({ length: 8 }, (_, i) => api.signup(`refd${i}`)));
    const codes = await race(8, (i) => svc.ensure(tenants[i]!.orgId, tenants[i]!.adminUserId));
    expect(new Set(codes).size).toBe(8);
  });
});

describe('CC-CPN: coupon redemption counter', () => {
  let t: Tenant;
  let n = 0;
  const mkCoupon = async (maxUses: number | null) => {
    const code = `CONC${Date.now()}${n++}`;
    const r = await q(
      `INSERT INTO coupons (code, type, amount, max_uses) VALUES ($1, 'percent', 10, $2) RETURNING id`,
      [code, maxUses],
    );
    return { id: Number(r.rows[0].id), code };
  };
  const mkOrder = async (c: { id: number; code: string }) =>
    Number(
      (
        await q(
          `INSERT INTO orders (org_id, order_number, user_id, currency, amount, kind, plan_slug, status, coupon_id, coupon_code)
           VALUES ($1, $2, $3, 'USD', 100, 'plan', 'plana', 'paid', $4, $5) RETURNING id`,
          [t.orgId, `ORD-${Date.now()}-${n++}`, t.adminUserId, c.id, c.code],
        )
      ).rows[0].id,
    );
  const redeem = (orderId: number) =>
    h.app
      .get(PlatformStore)
      .tx((tx) => h.app.get(CouponCheckoutService).redeemForOrder(tx, t.orgId, orderId));
  const used = async (id: number) =>
    scalar(`SELECT uses_count AS n FROM coupons WHERE id = $1`, [id]);

  beforeAll(async () => {
    t = await api.signup('cpn');
  });

  it('CC-CPN-01 one paid order finalised 8 times at once counts one use', async () => {
    const c = await mkCoupon(5);
    const order = await mkOrder(c);
    const res = await race(8, () => redeem(order));
    expect(res.filter((r) => r === c.code)).toHaveLength(1);
    expect(await used(c.id)).toBe(1);
  });

  it('CC-CPN-02 12 different orders finalised at once count 12 uses: no lost increment', async () => {
    const c = await mkCoupon(null);
    const orders = await Promise.all(Array.from({ length: 12 }, () => mkOrder(c)));
    await race(12, (i) => redeem(orders[i]!));
    expect(await used(c.id)).toBe(12);
    expect(
      await scalar(`SELECT count(*)::int AS n FROM coupon_redemptions WHERE coupon_id = $1`, [
        c.id,
      ]),
    ).toBe(12);
  });

  // OPEN (D-06): the limit is only checked when the buyer previews the price, not when an order is paid, so buyers racing for the
  // last use all get it. The code comments call this a kept Reference gap. `it.fails` documents it: this passes while the gap exists.
  it.fails(
    'CC-CPN-03 a coupon with 3 uses left, 8 buyers paying at once: uses never pass max_uses',
    async () => {
      const c = await mkCoupon(3);
      const orders = await Promise.all(Array.from({ length: 8 }, () => mkOrder(c)));
      await race(8, (i) => redeem(orders[i]!));
      expect(await used(c.id)).toBeLessThanOrEqual(3);
    },
  );
});

// --- sessions ------------------------------------------------------------------------------------------------------------------------

describe('CC-SES: refresh-token rotation and session cap', () => {
  const mint = async (t: Tenant, remember = true) => {
    const u = (await q(`SELECT uuid FROM users WHERE id = $1`, [t.adminUserId])).rows[0]
      .uuid as string;
    return h.app.get(SessionService).create({
      orgId: t.orgId,
      userId: t.adminUserId,
      userUuid: u,
      remember,
      mfaVerified: false,
    });
  };
  const refresh = (token: string) =>
    h.app
      .get(SessionService)
      .refresh(token)
      .then(
        (r) => ({ ok: true as const, tokens: r.tokens, sessionId: r.sessionId }),
        (e: { status?: number }) => ({ ok: false as const, status: e.status ?? 0 }),
      );
  const sessionRow = async (sid: string) =>
    (
      await q(
        `SELECT refresh_version, revoked_at, revoked_reason FROM auth_sessions WHERE uuid = $1`,
        [sid],
      )
    ).rows[0];
  const rvOf = async (token: string) => (await h.app.get(TokenService).verifyRefresh(token)).rv;

  it('CC-SES-01 one refresh token sent 6 times at once (a double click): all succeed, the session is not revoked, one rotation happened', async () => {
    const t = await api.signup('ses1');
    const first = await mint(t);
    let token = first.tokens.refreshToken;
    for (let round = 0; round < ROUNDS; round++) {
      const before = (await sessionRow(first.sessionId)).refresh_version as number;
      const res = await race(6, () => refresh(token));
      for (const r of res) expect(r.ok, JSON.stringify(res)).toBe(true);
      const row = await sessionRow(first.sessionId);
      expect(row.revoked_at).toBeNull();
      expect(row.refresh_version).toBe(before + 1);
      // Every answer carries the same current token version: nobody got a second, diverging session.
      const rvs = await Promise.all(
        res.map((r) => (r.ok ? rvOf(r.tokens.refreshToken) : Promise.resolve(-1))),
      );
      expect(new Set(rvs)).toEqual(new Set([before + 1]));
      expect(new Set(res.map((r) => (r.ok ? r.sessionId : ''))).size).toBe(1);
      const winner = res[0]!;
      if (winner.ok) token = winner.tokens.refreshToken;
    }
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL AND uuid = $2`,
        [t.adminUserId, first.sessionId],
      ),
    ).toBe(1);
  });

  it('CC-SES-02 a token two rotations old is a replay: every parallel attempt is refused and the whole session is revoked', async () => {
    const t = await api.signup('ses2');
    const s = await mint(t);
    const old = s.tokens.refreshToken;
    const r1 = await refresh(old);
    if (!r1.ok) throw new Error('first rotation failed');
    const r2 = await refresh(r1.tokens.refreshToken);
    if (!r2.ok) throw new Error('second rotation failed');
    const res = await race(5, () => refresh(old));
    for (const r of res) expect(r).toMatchObject({ ok: false, status: 401 });
    expect((await sessionRow(s.sessionId)).revoked_reason).toBe('refresh_reuse');
    // The thief's replay also ends the legitimate holder: this is the reuse rule working, not a lock-out of a double click.
    expect(await refresh(r2.tokens.refreshToken)).toMatchObject({ ok: false, status: 401 });
  });

  it('CC-SES-03 8 sign-ins at once with a cap of 2 leave at most 2 live sessions', async () => {
    const t = await api.signup('ses3');
    const op = Number((await q(`SELECT id AS n FROM platform_operators LIMIT 1`)).rows[0].n);
    await h.app.get(SecurityPolicyService).patchPolicy({ maxConcurrentSessions: 2 }, op);
    try {
      await race(8, () => mint(t));
      expect(
        await scalar(
          `SELECT count(*)::int AS n FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
          [t.adminUserId],
        ),
      ).toBeLessThanOrEqual(2);
    } finally {
      await h.app.get(SecurityPolicyService).patchPolicy({ maxConcurrentSessions: 50 }, op);
    }
  });
});

// --- storage counters ---------------------------------------------------------------------------------------------------------------

describe('CC-STO: storage counters (observe mode)', () => {
  it('CC-STO-01 20 uploads at once add up exactly; one key committed 6 times counts once; reservations all settle', async () => {
    const t = await api.signup('sto');
    const mode = {
      current: async () => 'observe' as const,
      configured: async () => 'observe' as const,
    };
    const meter = new StorageMeterService(db, new StorageQuotaRepository(), mode as never);
    await race(20, async (i) => {
      const r = await meter.reserve({ orgId: t.orgId, bytes: 1000, category: 'inbox_media' });
      await sleep(Math.floor(rng() * 10));
      await r.commit({ key: `conc/${t.orgId}/${i}` });
    });
    const state = async () =>
      (
        await q(
          `SELECT hot_bytes::bigint AS hot, reserved_bytes::bigint AS reserved FROM storage_org_state WHERE org_id = $1`,
          [t.orgId],
        )
      ).rows[0];
    expect(Number((await state()).hot)).toBe(20_000);
    expect(Number((await state()).reserved)).toBe(0);
    await race(6, async () => {
      const r = await meter.reserve({ orgId: t.orgId, bytes: 500, category: 'inbox_media' });
      await r.commit({ key: `conc/${t.orgId}/same` });
    });
    expect(Number((await state()).hot)).toBe(20_500);
    expect(Number((await state()).reserved)).toBe(0);
    expect(
      await scalar(`SELECT count(*)::int AS n FROM storage_reservations WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(0);
  });
});

// --- outbox -------------------------------------------------------------------------------------------------------------------------

describe('CC-OBX: outbox drain with several workers', () => {
  let type = 0;
  const seed = async (orgId: number, eventType: string, n: number) => {
    await q(
      `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
       SELECT $1, 'conc', (g % 40), $2, jsonb_build_object('n', g) FROM generate_series(1, $3) g`,
      [orgId, eventType, n],
    );
  };
  const drainers = (count: number, handle: (id: string) => Promise<void>, eventType: string) =>
    Array.from({ length: count }, () => {
      const registry = new OutboxSubscriberRegistry();
      registry.register({
        name: `conc-${eventType}`,
        eventTypes: [eventType],
        handle: async (e) => handle(e.id),
      });
      return new OutboxDrainService(db, registry);
    });

  it('CC-OBX-01 three workers draining 700 events: every event handled exactly once, none left pending', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const t = await api.signup('obx1');
      const eventType = `conc.drain.${type++}`;
      await seed(t.orgId, eventType, 700);
      const seen = new Map<string, number>();
      const ds = drainers(
        3,
        async (id) => {
          seen.set(id, (seen.get(id) ?? 0) + 1);
          await sleep(Math.floor(rng() * 3));
        },
        eventType,
      );
      await Promise.all(
        ds.map(async (d) => {
          await sleep(Math.floor(rng() * 20));
          await d.drain();
        }),
      );
      expect(seen.size).toBe(700);
      expect([...seen.values()].every((c) => c === 1)).toBe(true);
      expect(
        await scalar(
          `SELECT count(*)::int AS n FROM event_outbox WHERE event_type = $1 AND status = 'done'`,
          [eventType],
        ),
      ).toBe(700);
      expect(
        await scalar(
          `SELECT count(*)::int AS n FROM event_outbox WHERE event_type = $1 AND status <> 'done'`,
          [eventType],
        ),
      ).toBe(0);
    }
  });

  it('CC-OBX-02 a subscriber that fails for some events: failures are kept for retry (not lost, not marked done), the rest are handled once', async () => {
    const t = await api.signup('obx2');
    const eventType = `conc.fail.${type++}`;
    await seed(t.orgId, eventType, 300);
    const seen = new Map<string, number>();
    const bad = new Set<string>();
    const ds = drainers(
      2,
      async (id) => {
        seen.set(id, (seen.get(id) ?? 0) + 1);
        if (Number(id) % 5 === 0) {
          bad.add(id);
          throw new Error('boom');
        }
      },
      eventType,
    );
    await Promise.all(ds.map((d) => d.drain()));
    const done = await scalar(
      `SELECT count(*)::int AS n FROM event_outbox WHERE event_type = $1 AND status = 'done'`,
      [eventType],
    );
    const pending = await scalar(
      `SELECT count(*)::int AS n FROM event_outbox WHERE event_type = $1 AND status = 'pending' AND attempts = 1 AND last_error IS NOT NULL`,
      [eventType],
    );
    expect(done + pending).toBe(300);
    expect(pending).toBe(bad.size);
    expect([...seen.values()].every((c) => c === 1)).toBe(true);
  });
});

// --- invoices ------------------------------------------------------------------------------------------------------------------------

describe('CC-INV: invoice numbers and payments', () => {
  const LINES = [{ description: 'Widget', qty: '4', unitPrice: '50.00', taxRateId: null }];
  const draft = async (t: Tenant) => {
    const r = await api
      .as(t.admin)
      .post('/v2/invoices')
      .send({ buyerName: 'Conc Co', currency: 'USD', lines: LINES });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };

  it('CC-INV-01 10 drafts issued at once get 10 different, gap-free numbers', async () => {
    const t = await api.signup('inv1');
    const ids = await Promise.all(Array.from({ length: 10 }, () => draft(t)));
    const res = await race(10, (i) =>
      api.as(t.admin).post(`/v2/invoices/${ids[i]}/issue`).send({}),
    );
    for (const r of res) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const nums = res.map((r) => r.body.number as string);
    expect(new Set(nums).size).toBe(10);
    const seqs = (
      await q(`SELECT seq FROM invoices WHERE org_id = $1 AND status = 'issued' ORDER BY seq`, [
        t.orgId,
      ])
    ).rows.map((r) => Number(r.seq));
    expect(seqs).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it('CC-INV-02 one draft issued 6 times at once is issued once and uses one number', async () => {
    const t = await api.signup('inv2');
    const id = await draft(t);
    const res = await race(6, () => api.as(t.admin).post(`/v2/invoices/${id}/issue`).send({}));
    for (const r of res) expect([200, 409], JSON.stringify(r.body)).toContain(r.status);
    expect(res.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(new Set(res.filter((r) => r.status === 200).map((r) => r.body.number)).size).toBe(1);
    // The next invoice takes number 2: the losers did not burn a number.
    const next = await draft(t);
    const issued = await api.as(t.admin).post(`/v2/invoices/${next}/issue`).send({});
    expect(
      Number(
        (
          await q(`SELECT seq FROM invoices WHERE org_id = $1 AND uuid = $2`, [
            t.orgId,
            issued.body.id,
          ])
        ).rows[0].seq,
      ),
    ).toBe(2);
  });

  it('CC-INV-03 six payments of 50.00 at once on a 200.00 invoice never record more than 200.00', async () => {
    const t = await api.signup('inv3');
    const id = await draft(t);
    const issued = await api.as(t.admin).post(`/v2/invoices/${id}/issue`).send({});
    expect(issued.status).toBe(200);
    const res = await race(6, () =>
      api.as(t.admin).post(`/v2/invoices/${id}/payments`).send({ amount: '50.00', method: 'bank' }),
    );
    for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    const paid = Number(
      (
        await q(
          `SELECT coalesce(sum(amount_minor), 0)::bigint AS n FROM payments WHERE org_id = $1 AND kind = 'payment'`,
          [t.orgId],
        )
      ).rows[0].n,
    );
    expect(paid).toBeLessThanOrEqual(20_000);
  });
});
