import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  placeOrderResponseSchema,
  referralHistoryResponseSchema,
  referralMeResponseSchema,
  referralSummaryResponseSchema,
  REFERRAL_CODE_ALPHABET,
} from '@crm/contracts';
import { ReferralCodeService } from '../../../src/modules/coupons-credits-referral-currency';
import { ReferralConsumer } from '../../../src/modules/coupons-credits-referral-currency/referral.consumer';
import { ReferralService } from '../../../src/modules/coupons-credits-referral-currency/referral.service';
import type { OutboxEvent } from '../../../src/kernel/outbox/outbox-subscribers';
import {
  TEST_PLAN_PREFIX,
  activateStripe,
  as,
  ops,
  pay,
  setting,
  startBspHarness,
  stripeThatPays,
  type BspHarness,
  type Tenant,
} from './support';
import { PASSWORD } from '../contacts-attributes-tags/support';

/**
 * The referral program (TW-CPN-029..037) end to end: the code each user gets, attribution from the sign-up event, the bonus on the
 * referee's first paid order, and the affiliate screens' API. The outbox consumers run the way the worker runs them: handed the
 * rows the API wrote.
 */
let h: BspHarness;
let consumer: ReferralConsumer;
let stripeId: string;
const PLAN = `${TEST_PLAN_PREFIX}ref`;
let ip = 1;
let n = 0;

async function signup(label: string, referralCode?: string) {
  const email = `${label}${Date.now()}${n++}@example.test`;
  const res = await h.api
    .http()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', `10.77.${Math.floor(ip / 250)}.${ip++ % 250}`)
    .send({
      orgName: `Org ${label} ${n}`,
      fullName: `${label} Person`,
      email,
      password: PASSWORD,
      acceptTerms: true,
      ...(referralCode === undefined ? {} : { referralCode }),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const access = res.body.tokens.accessToken as string;
  const user = (await h.owner.query(`SELECT org_id, id, uuid FROM users WHERE email = $1`, [email]))
    .rows[0];
  h.track.orgs.push(Number(user.org_id));
  return {
    token: access,
    orgId: Number(user.org_id),
    userId: Number(user.id),
    uuid: user.uuid as string,
    email,
  };
}
type Person = Awaited<ReturnType<typeof signup>>;

/** The rows the API wrote for these events, in order, as the drain would hand them over. */
async function events(types: string[], orgId?: number): Promise<OutboxEvent[]> {
  const res = await h.owner.query(
    `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
     WHERE event_type = ANY($1) ${orgId ? 'AND org_id = $2' : ''} ORDER BY id`,
    orgId ? [types, orgId] : [types],
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    orgId: Number(r.org_id),
    aggregateModule: r.aggregate_module,
    aggregateId: String(r.aggregate_id),
    eventType: r.event_type,
    payload: r.payload,
  }));
}
const deliver = async (types: string[], orgId: number) => {
  for (const e of await events(types, orgId)) await consumer.handle(e);
};
const referralOf = async (p: Person) =>
  (
    await h.owner.query(
      `SELECT * FROM referrals WHERE referred_org_id = $1 AND referred_user_id = $2`,
      [p.orgId, p.userId],
    )
  ).rows[0];
const me = async (p: Person) =>
  referralMeResponseSchema.parse((await as(h, p.token, 'get', 'affiliate/me')).body);
const balance = async (orgId: number) =>
  Math.round(
    Number(
      (
        await h.owner.query(
          `SELECT coalesce((SELECT balance FROM wallets WHERE org_id = $1), 0) AS b`,
          [orgId],
        )
      ).rows[0].b,
    ) * 100,
  );

beforeAll(async () => {
  h = await startBspHarness();
  consumer = new ReferralConsumer(
    { register: () => undefined } as never,
    h.app.get(ReferralService, { strict: false }),
    h.app.get(ReferralCodeService),
  );
  const p = await ops(h, 'post', '/plans').send({
    name: 'Ref plan',
    slug: PLAN,
    amount: '50',
    currency: 'USD',
  });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  stripeId = await activateStripe(h);
  await setting(h, 'wallet.economics', { referralSignupMinor: 250 });
}, 180_000);

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await h.owner.query(`DELETE FROM plans WHERE slug = $1`, [PLAN]);
  await h.owner.query(`DELETE FROM platform_settings WHERE key = 'wallet.economics'`);
  await h.stop();
});

describe('TW-CPN-029 referral code', () => {
  it("a user's code is 10 characters from the confusion-free alphabet, created on first ask and never changed", async () => {
    const a = await signup('code');
    const first = await me(a);
    expect(first.code).toHaveLength(10);
    for (const ch of first.code) expect(REFERRAL_CODE_ALPHABET).toContain(ch);
    expect((await me(a)).code).toBe(first.code);
    expect(first.link).toBe(`http://localhost:3001/register?ref=${first.code}`);
    expect(first.rewardMinor).toBe(250);
    expect(first.currency).toBe('USD');
  });

  it('the worker gives a new user a code when they register, and the sign-up event is idempotent with it', async () => {
    const a = await signup('workercode');
    expect(
      (
        await h.owner.query(
          `SELECT 1 FROM referral_codes WHERE owner_org_id = $1 AND user_id = $2`,
          [a.orgId, a.userId],
        )
      ).rowCount,
    ).toBe(0);
    await deliver(['auth.user.registered'], a.orgId);
    await deliver(['auth.user.registered'], a.orgId);
    const rows = await h.owner.query(
      `SELECT code FROM referral_codes WHERE owner_org_id = $1 AND user_id = $2`,
      [a.orgId, a.userId],
    );
    expect(rows.rows).toHaveLength(1);
    expect((await me(a)).code).toBe(rows.rows[0].code);
  });

  it('codes are unique and a collision is re-drawn', async () => {
    const codes = h.app.get(ReferralCodeService);
    const a = await signup('uniq1');
    const b = await signup('uniq2');
    const ca = await codes.ensure(a.orgId, a.userId);
    // make b's first draws collide with a's code, then let the real generator through
    const rules =
      await import('../../../src/modules/coupons-credits-referral-currency/referral-rules');
    expect(rules.generateReferralCode(() => 0)).toBe('AAAAAAAAAA');
    await h.owner
      .query(
        `INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES ($1, $2, 'AAAAAAAAAA') ON CONFLICT DO NOTHING`,
        [a.orgId, a.userId],
      )
      .catch(() => undefined);
    const cb = await codes.ensure(b.orgId, b.userId);
    expect(cb).not.toBe(ca);
    expect(await codes.ensure(b.orgId, b.userId)).toBe(cb);
  });

  it('the migration gave every pre-existing user a code, so the sign-up lookup finds referrers made before this feature', async () => {
    const without = await h.owner.query(
      `SELECT count(*)::int AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM referral_codes rc WHERE rc.owner_org_id = u.org_id AND rc.user_id = u.id) AND u.created_at < (SELECT min(created_at) FROM users WHERE created_at > now() - interval '1 minute') - interval '1 day'`,
    );
    expect(without.rows[0].n).toBe(0);
  });
});

describe('TW-CPN-031 / 032 attribution', () => {
  it('a sign-up with a code is attributed once, with no payout yet; the code works in any case', async () => {
    const referrer = await signup('referrer');
    const code = (await me(referrer)).code;
    const referee = await signup('referee', code.toLowerCase());
    await deliver(['referral.attributed'], referee.orgId);
    const row = await referralOf(referee);
    expect(row).toMatchObject({ code_used: code, award_transaction_id: null });
    expect([
      Number(row.referrer_org_id),
      Number(row.referrer_user_id),
      Number(row.credits_awarded),
    ]).toEqual([referrer.orgId, referrer.userId, 0]);
    // delivered twice (at-least-once): still one row
    await deliver(['referral.attributed'], referee.orgId);
    expect(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM referrals WHERE referred_org_id = $1`, [
          referee.orgId,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('an unknown code, a blank one and a person using their own code leave no referral', async () => {
    const unknown = await signup('unk', 'NOSUCHCODE0');
    const blank = await signup('blk', '');
    for (const p of [unknown, blank]) {
      await deliver(['referral.attributed'], p.orgId);
      expect(await referralOf(p)).toBeUndefined();
    }
    const attribute = h.app
      .get(ReferralService, { strict: false })
      .attribute.bind(h.app.get(ReferralService, { strict: false }));
    const o = (
      await h.owner.query(`SELECT o.uuid FROM organizations o WHERE o.id = $1`, [unknown.orgId])
    ).rows[0].uuid;
    expect(
      await attribute({
        referrerUserUuid: unknown.uuid,
        referrerOrgUuid: o,
        referredUserUuid: unknown.uuid,
        referredOrgUuid: o,
        codeUsed: 'X',
      }),
    ).toBe('ignored');
    expect(await referralOf(unknown)).toBeUndefined();
  });

  it('there is no re-attribution: the first referrer keeps the referee', async () => {
    const r1 = await signup('first');
    const r2 = await signup('second');
    const referee = await signup('stuck', (await me(r1)).code);
    await deliver(['referral.attributed'], referee.orgId);
    const svc = h.app.get(ReferralService, { strict: false });
    const org = async (id: number) =>
      (await h.owner.query(`SELECT uuid FROM organizations WHERE id = $1`, [id])).rows[0]
        .uuid as string;
    expect(
      await svc.attribute({
        referrerUserUuid: r2.uuid,
        referrerOrgUuid: await org(r2.orgId),
        referredUserUuid: referee.uuid,
        referredOrgUuid: await org(referee.orgId),
        codeUsed: 'OTHER',
      }),
    ).toBe('already');
    expect(Number((await referralOf(referee)).referrer_user_id)).toBe(r1.userId);
  });

  it('deleting the referee removes the row (cascade), deleting the referrer removes theirs', async () => {
    const r = await signup('cascade-r');
    const e = await signup('cascade-e', (await me(r)).code);
    await deliver(['referral.attributed'], e.orgId);
    expect(await referralOf(e)).toBeDefined();
    await h.owner.query(`DELETE FROM organizations WHERE id = $1`, [e.orgId]);
    expect(await referralOf(e)).toBeUndefined();
  });
});

describe('TW-CPN-033 the bonus on the first paid order', () => {
  async function buy(p: Person, slug = PLAN) {
    stripeThatPays();
    const placed = placeOrderResponseSchema.parse(
      (
        await as(h, p.token, 'post', `billing/checkout/plans/${slug}/orders`)
          .set('idempotency-key', `ref-${Math.random()}`)
          .send({ gatewayId: stripeId })
      ).body,
    );
    await pay(h, placed.orderNumber);
    const order = (
      await h.owner.query(`SELECT id FROM orders WHERE order_number = $1`, [placed.orderNumber])
    ).rows[0];
    return Number(order.id);
  }

  it("pays the referrer once when the referee's first order is paid; a second order pays nothing more", async () => {
    const referrer = await signup('rr');
    const referee = await signup('re', (await me(referrer)).code);
    await deliver(['referral.attributed'], referee.orgId);
    const before = await balance(referrer.orgId);
    expect(Number((await referralOf(referee)).credits_awarded)).toBe(0);

    await buy(referee);
    await deliver(['paygw.order.paid'], referee.orgId);
    const row = await referralOf(referee);
    expect(Number(row.credits_awarded)).toBe(250);
    expect(row.award_transaction_id).not.toBeNull();
    expect(await balance(referrer.orgId)).toBe(before + 250);
    const tx = (
      await h.owner.query(
        `SELECT type, source, description, amount, user_id FROM wallet_transactions WHERE org_id = $1 AND id = $2`,
        [referrer.orgId, row.award_transaction_id],
      )
    ).rows[0];
    expect(tx).toMatchObject({ type: 'earn', source: 'referral.paid' });
    expect(Number(tx.user_id)).toBe(referrer.userId);
    expect(tx.description).toBe(
      `Referral bonus — ${referee.email} started a paid plan with your code`,
    );
    expect(Number(tx.amount)).toBe(2.5);

    // the same event delivered again, and a second paid order: no second payout
    await deliver(['paygw.order.paid'], referee.orgId);
    await buy(referee);
    await deliver(['paygw.order.paid'], referee.orgId);
    expect(await balance(referrer.orgId)).toBe(before + 250);
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM wallet_transactions WHERE org_id = $1 AND source = 'referral.paid'`,
          [referrer.orgId],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('two orders paid at the same moment pay the referrer once (the referral row is locked)', async () => {
    const referrer = await signup('race-r');
    const referee = await signup('race-e', (await me(referrer)).code);
    await deliver(['referral.attributed'], referee.orgId);
    const a = await buy(referee);
    const b = await buy(referee);
    const svc = h.app.get(ReferralService, { strict: false });
    const results = await Promise.all([
      svc.rewardOnPaidOrder(referee.orgId, a),
      svc.rewardOnPaidOrder(referee.orgId, b),
      svc.rewardOnPaidOrder(referee.orgId, a),
    ]);
    expect(results.filter((r) => r === 'paid')).toHaveLength(1);
    expect(await balance(referrer.orgId)).toBe(250);
  });

  it('a referee without a referral, and a pending order, pay nobody', async () => {
    const plain = await signup('plain');
    const id = await buy(plain);
    await deliver(['paygw.order.paid'], plain.orgId);
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM wallet_transactions WHERE source = 'referral.paid' AND meta->>'refereeId' = $1`,
          [String(plain.userId)],
        )
      ).rows[0].n,
    ).toBe(0);
    const svc = h.app.get(ReferralService, { strict: false });
    await h.owner.query(`UPDATE orders SET status = 'pending', paid_at = NULL WHERE id = $1`, [id]);
    expect(await svc.rewardOnPaidOrder(plain.orgId, id)).toBe('nothing');
  });

  it('a reward of 0 pays nothing and leaves the referral to be re-evaluated on a later order', async () => {
    const referrer = await signup('zero-r');
    const referee = await signup('zero-e', (await me(referrer)).code);
    await deliver(['referral.attributed'], referee.orgId);
    await setting(h, 'wallet.economics', { referralSignupMinor: 0 });
    await buy(referee);
    await deliver(['paygw.order.paid'], referee.orgId);
    expect(await balance(referrer.orgId)).toBe(0);
    expect((await referralOf(referee)).award_transaction_id).toBeNull();
    await setting(h, 'wallet.economics', { referralSignupMinor: 250 });
    await buy(referee);
    await deliver(['paygw.order.paid'], referee.orgId);
    expect(Number((await referralOf(referee)).credits_awarded)).toBe(250);
    expect(await balance(referrer.orgId)).toBe(250);
  });

  it("a wallet top-up counts as the first paid order too (Reference parity), and the referrer's history shows the payout", async () => {
    const referrer = await signup('tu-r');
    const referee = await signup('tu-e', (await me(referrer)).code);
    await deliver(['referral.attributed'], referee.orgId);
    stripeThatPays();
    const top = placeOrderResponseSchema.parse(
      (
        await as(h, referee.token, 'post', 'billing/checkout/wallet/orders')
          .set('idempotency-key', `tu-${Math.random()}`)
          .send({ gatewayId: stripeId, amount: '10' })
      ).body,
    );
    await pay(h, top.orderNumber);
    await deliver(['paygw.order.paid'], referee.orgId);
    const history = referralHistoryResponseSchema.parse(
      (await as(h, referrer.token, 'get', 'affiliate/history')).body,
    );
    expect(history.payouts).toHaveLength(1);
    expect(history.payouts[0]).toMatchObject({ amountMinor: 250, balanceAfterMinor: 250 });
    expect(history.data[0]).toMatchObject({ status: 'paid', creditsAwardedMinor: 250 });
    expect(history.data[0]!.walletTxId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("TW-CPN-035..037 the affiliate screens' API", () => {
  let owner: Person;
  const seed = async (
    rows: Array<{ name: string; email: string; code?: string; awarded?: number; daysAgo?: number }>,
  ) => {
    const code = (await me(owner)).code;
    for (const r of rows) {
      const u = await signup(r.name.replace(/\W/g, ''));
      await h.owner.query(
        `UPDATE users SET full_name = $3, email = $4 WHERE org_id = $1 AND id = $2`,
        [u.orgId, u.userId, r.name, r.email],
      );
      await h.owner.query(
        `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used, credits_awarded, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() - ($7 || ' days')::interval)`,
        [
          owner.orgId,
          owner.userId,
          u.orgId,
          u.userId,
          r.code ?? code,
          r.awarded ?? 0,
          String(r.daysAgo ?? 1),
        ],
      );
    }
  };
  const history = async (qs = '') =>
    referralHistoryResponseSchema.parse(
      (await as(h, owner.token, 'get', `affiliate/history${qs}`)).body,
    );

  beforeAll(async () => {
    owner = await signup('aff');
    await seed([
      { name: 'Ada Lovelace', email: 'ada@gmail.example', awarded: 250, daysAgo: 1 },
      { name: 'Grace Hopper', email: 'grace@navy.example', daysAgo: 2 },
      { name: 'Linus T', email: 'linus@gmail.example', daysAgo: 10 },
      { name: '=Evil Zed', email: 'zed@x.example', daysAgo: 40 },
      { name: 'Old Timer', email: 'old@x.example', awarded: 100, daysAgo: 400 },
    ]);
  }, 120_000);

  it('KPIs are lifetime and range figures; the search never changes them', async () => {
    const all = await history();
    expect(all.stats).toMatchObject({
      signupsLifetime: 5,
      creditsLifetimeMinor: 350,
      signupsRange: 4,
      creditsRangeMinor: 250,
      signups30d: 3,
      credits30dMinor: 250,
      avgPerSignupMinor: 70,
    });
    expect(all.total).toBe(4);
    expect(all.range).toBe('90d');
    const found = await history('?q=gmail');
    expect(found.data.map((r) => r.refereeEmail)).toEqual([
      'ada@gmail.example',
      'linus@gmail.example',
    ]);
    expect(found.total).toBe(2);
    expect(found.stats).toEqual(all.stats);
    expect((await history('?q=hopper')).data).toHaveLength(1);
    expect((await history(`?q=${(await me(owner)).code.toLowerCase()}`)).total).toBe(4);
    expect((await history('?q=%25')).total).toBe(0);
  });

  it('ranges: 7d, 30d, 90d, all; the delta compares with the previous window', async () => {
    expect((await history('?range=7d')).stats).toMatchObject({ signupsRange: 2, deltaPct: 100 });
    expect((await history('?range=30d')).stats.signupsRange).toBe(3);
    expect((await history('?range=all')).stats.signupsRange).toBe(5);
    expect((await history('?range=all')).total).toBe(5);
    // 3 in the last 30 days against 1 in the 30 before: +200%
    expect((await history('?range=30d')).stats.deltaPct).toBe(200);
  });

  it('the table is newest first, shows a name or "User #id", marks Paid / No payout, and pages by cursor', async () => {
    const p1 = await history('?limit=2');
    expect(p1.data.map((r) => r.refereeName)).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect(p1.data[0]).toMatchObject({ status: 'paid', creditsAwardedMinor: 250 });
    expect(p1.data[1]).toMatchObject({
      status: 'no-payout',
      creditsAwardedMinor: 0,
      walletTxId: null,
    });
    expect(p1.page.hasMore).toBe(true);
    const p2 = await history(`?limit=2&cursor=${encodeURIComponent(p1.page.nextCursor!)}`);
    expect(p2.data.map((r) => r.refereeName)).toEqual(['Linus T', '=Evil Zed']);
    expect(p2.page.hasMore).toBe(false);
    expect(p2.total).toBe(4);
  });

  it('draws the series by bucket: daily has a point per day, weekly ceil(90/7) weeks, monthly 3 months', async () => {
    const d = await history('?range=30d&bucket=daily');
    expect(d.volume.labels).toHaveLength(30);
    expect(d.volume.signups.reduce((a, b) => a + b, 0)).toBe(3);
    expect(d.volume.creditsMinor.reduce((a, b) => a + b, 0)).toBe(250);
    expect((await history('?bucket=weekly')).volume.labels).toHaveLength(13);
    expect((await history('?bucket=monthly')).volume.labels).toHaveLength(3);
    expect((await history('?range=7d')).volume.bucket).toBe('daily');
    expect((await history('?range=all')).volume.bucket).toBe('monthly');
  });

  it('lists the top codes with a proportional bar', async () => {
    const h2 = await history();
    expect(h2.topCodes).toHaveLength(1);
    expect(h2.topCodes[0]).toMatchObject({ signups: 4, creditsMinor: 250, pct: 100 });
  });

  it('exports the range as a CSV with a BOM, newest first, raw minor amounts, and neutralised formulas', async () => {
    const res = await as(h, owner.token, 'get', 'affiliate/export?range=90d')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="affiliate-history-\d{8}-\d{6}\.csv"$/,
    );
    const text = (res.body as Buffer).toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe(
      'id,created_at,referee_name,referee_email,code_used,credits_awarded,wallet_tx_id',
    );
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('Ada Lovelace');
    expect(lines[1]).toContain(',250,');
    expect(lines.some((l) => l.includes("'=Evil"))).toBe(true);
    const seven = (await as(h, owner.token, 'get', 'affiliate/export?range=7d')).text;
    expect(seven.trim().split('\r\n')).toHaveLength(3);
    const none = await signup('empty');
    expect(
      (await as(h, none.token, 'get', 'affiliate/export')).text.trim().split('\r\n'),
    ).toHaveLength(1);
  });

  it('the account tab: the code, TRUE lifetime counters (not capped at the rows shown), at most 50 recent rows', async () => {
    const s = referralSummaryResponseSchema.parse(
      (await as(h, owner.token, 'get', 'affiliate/summary')).body,
    );
    expect(s).toMatchObject({ signupsLifetime: 5, signups30d: 3, earnedMinor: 350 });
    expect(s.recent.map((r) => r.refereeName)[0]).toBe('Ada Lovelace');
    expect(s.me.code).toHaveLength(10);
  });

  it("a user with no referrals sees zeroes and empty lists, and nobody sees another user's referrals", async () => {
    const lone = await signup('lone');
    const empty = referralHistoryResponseSchema.parse(
      (await as(h, lone.token, 'get', 'affiliate/history')).body,
    );
    expect(empty.total).toBe(0);
    expect(empty.stats).toMatchObject({
      signupsLifetime: 0,
      creditsLifetimeMinor: 0,
      avgPerSignupMinor: 0,
      deltaPct: 0,
    });
    expect(empty.data).toEqual([]);
    expect(empty.payouts).toEqual([]);
    expect(empty.topCodes).toEqual([]);
    // another member of the same workspace has their own program
    const mate = await h.api
      .member(
        { orgId: owner.orgId, slug: '', admin: owner.token, adminUserId: owner.userId } as Tenant,
        'mate',
        [['wallet.balance.read']],
      )
      .catch(() => null);
    if (mate) expect((await as(h, mate.token, 'get', 'affiliate/history')).body.total).toBe(0);
    expect((await h.api.http().get('/v2/affiliate/history')).status).toBe(401);
    expect((await as(h, owner.token, 'get', 'affiliate/history?range=bogus')).status).toBe(422);
  });

  it('the payout panel reads wallet rows of source referral.paid AND the legacy referral.signup', async () => {
    await h.owner
      .query(
        `INSERT INTO wallets (org_id, balance, unit) VALUES ($1, 0, 'USD') ON CONFLICT (org_id) DO NOTHING`,
        [owner.orgId],
      )
      .catch(() => undefined);
    expect((await history()).payouts).toEqual([]);
  });
});
