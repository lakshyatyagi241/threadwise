import { hash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CSV_COLUMNS,
  referralListResponseSchema,
  referralOverviewSchema,
  type ReferralListResponse,
} from '@crm/contracts';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
} from '../../../src/kernel/outbox/outbox-subscribers';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { WalletLedgerService } from '../../../src/modules/wallet-message-billing';
import { CpnStore } from '../../../src/modules/coupons-credits-referral-currency/cpn-store';
import { ReferralAttributionService } from '../../../src/modules/coupons-credits-referral-currency/referral-attribution.service';
import { ReferralCodeService } from '../../../src/modules/coupons-credits-referral-currency/referral-code.service';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * The referral programme end to end (TW-CPN-029..037) against a real Postgres and Redis and the real AppModule, with the three
 * referral consumers loaded the way the worker loads them. The harness runs no outbox drain, so `deliver` plays the drain's part:
 * it hands the rows in the outbox to the registry, deterministically and as often as a test wants (at-least-once delivery).
 * Every test name starts with the id of the acceptance criterion it proves.
 */
let h: Harness;
let registry: OutboxSubscriberRegistry;
let opToken = '';
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const PASSWORD = 'Str0ngPassw0rd#1';
const ALPHABET = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{10}$`);

let n = 0;
const nextIp = () => `10.77.${Math.floor(n / 250)}.${n++ % 250}`;
const uniqueEmail = (tag = 'ref') => `${tag}${Date.now()}${n++}@example.test`;

interface Account {
  email: string;
  access: string;
  slug: string;
  orgId: number;
  userId: number;
  orgUuid: string;
  userUuid: string;
}

async function signup(over: Record<string, unknown> = {}): Promise<Account> {
  const email = (over.email as string) ?? uniqueEmail();
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', nextIp())
    .send({
      orgName: `Ref Org ${email.slice(0, 14)}`,
      fullName: (over.fullName as string) ?? 'Ref Person',
      email,
      password: PASSWORD,
      acceptTerms: true,
      ...over,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return account(email, res.body.tokens.accessToken, res.body.orgSlug);
}

async function account(email: string, access: string, slug: string): Promise<Account> {
  const r = await h.owner.query(
    `SELECT u.org_id, u.id, u.uuid AS user_uuid, o.uuid AS org_uuid
       FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.email = $1`,
    [email],
  );
  return {
    email,
    access,
    slug,
    orgId: Number(r.rows[0].org_id),
    userId: Number(r.rows[0].id),
    userUuid: r.rows[0].user_uuid,
    orgUuid: r.rows[0].org_uuid,
  };
}

/** A second person in the same workspace, signed in (the "own data, not the workspace's" rule). */
async function addMember(a: Account): Promise<Account> {
  const email = uniqueEmail('member');
  const row = await h.owner.query(
    `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, $2, 'Member Person', $3) RETURNING id`,
    [a.orgId, email, await hash(PASSWORD)],
  );
  await h.owner.query(
    `INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at) VALUES ($1, $2, now(), now())`,
    [a.orgId, Number(row.rows[0].id)],
  );
  const login = await api()
    .post('/v2/auth/login')
    .set('x-forwarded-for', nextIp())
    .send({ orgSlug: a.slug, email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(201);
  return account(email, login.body.tokens.accessToken, a.slug);
}

const overview = async (a: Account) => {
  const res = await api().get('/v2/me/referral').set(bearer(a.access));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return referralOverviewSchema.parse(res.body);
};
const listRaw = (a: Account, qs = '') => api().get(`/v2/me/referrals${qs}`).set(bearer(a.access));
const list = async (a: Account, qs = ''): Promise<ReferralListResponse> => {
  const res = await listRaw(a, qs);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return referralListResponseSchema.parse(res.body);
};
const exportCsv = (a: Account, qs = '') =>
  api()
    .get(`/v2/me/referrals/export${qs}`)
    .set(bearer(a.access))
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
    });

const codeOf = async (a: Account) => (await overview(a)).code;
const rows = async (sql: string, params: unknown[] = []) => (await h.owner.query(sql, params)).rows;

const delivered = new Set<string>();
let evSeq = 0;
/** Plays the outbox drain for the given workspaces: hands pending rows of these types to the registry. */
async function deliver(orgIds: number[], types: string[], again = false): Promise<number> {
  const res = await h.owner.query(
    `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
      WHERE org_id = ANY($1::bigint[]) AND event_type = ANY($2::text[]) ORDER BY id`,
    [orgIds, types],
  );
  let count = 0;
  for (const r of res.rows) {
    if (!again && delivered.has(String(r.id))) continue;
    delivered.add(String(r.id));
    await registry.dispatch({
      id: String(r.id),
      orgId: Number(r.org_id),
      aggregateModule: r.aggregate_module,
      aggregateId: String(r.aggregate_id),
      eventType: r.event_type,
      payload: r.payload,
    });
    count++;
  }
  return count;
}

/** What checkout announces when an order is paid; the reward consumer only needs the workspace. */
const orderPaid = (orgId: number): OutboxEvent => ({
  id: `synthetic-${++evSeq}`,
  orgId,
  aggregateModule: 'orders',
  aggregateId: '1',
  eventType: 'paygw.order.paid',
  payload: {
    orderNumber: `T-${evSeq}`,
    kind: 'plan',
    currency: 'USD',
    total: '10.00',
    gateway: 'razorpay',
  },
});

const balance = async (orgId: number): Promise<number> => {
  const r = await rows(
    `SELECT balance::text AS b FROM wallets WHERE org_id = $1 AND unit = 'USD'`,
    [orgId],
  );
  return r[0] ? Math.round(Number(r[0].b) * 100) : 0;
};
const referralOf = async (referredUserId: number) =>
  (await rows(`SELECT * FROM referrals WHERE referred_user_id = $1`, [referredUserId]))[0];

const setReward = (minor: number) =>
  h.app
    .get(PlatformSettingsService, { strict: false })
    .set('wallet.economics', { referralSignupMinor: minor }, null);

let seedOrg = 0;
/** Referees for a referrer, straight into the tables (volume tests need dozens, spread over dates and states). */
async function seedReferrals(
  referrer: Account,
  specs: Array<{
    name: string | null;
    email: string;
    daysAgo: number;
    code?: string;
    paidMinor?: number;
  }>,
): Promise<void> {
  if (!seedOrg) {
    seedOrg = Number(
      (
        await rows(
          `INSERT INTO organizations (slug, name) VALUES ($1, 'seed referees') RETURNING id`,
          [`seed-ref-${Date.now()}`],
        )
      )[0].id,
    );
  }
  const code = await codeOf(referrer);
  const db = h.app.get(DatabaseService, { strict: false });
  const ledger = h.app.get(WalletLedgerService, { strict: false });
  for (const s of specs) {
    const u = await rows(
      `INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id`,
      [seedOrg, s.email, s.name ?? ''],
    );
    const ref = await rows(
      `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used, created_at)
       VALUES ($1, $2, $3, $4, $5, now() - ($6 || ' days')::interval - ($7 || ' seconds')::interval) RETURNING id`,
      [
        referrer.orgId,
        referrer.userId,
        seedOrg,
        Number(u[0].id),
        s.code ?? code,
        String(s.daysAgo),
        String(n++ % 50),
      ],
    );
    if (s.paidMinor) {
      await db.privileged(async (tx) => {
        const p = await ledger.post(tx, {
          orgId: referrer.orgId,
          unit: 'USD',
          type: 'earn',
          direction: 'in',
          amountMinor: s.paidMinor!,
          idempotencyKey: `referral:${ref[0].id}`,
          source: 'referral.paid',
          subject: { type: 'referral', id: Number(ref[0].id) },
          userId: referrer.userId,
        });
        await tx.execute(
          sql`UPDATE referrals SET credits_awarded = ${s.paidMinor}, award_transaction_id = ${p.transactionRowId} WHERE id = ${Number(ref[0].id)}`,
        );
      });
    }
  }
}

beforeAll(async () => {
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/coupons-credits-referral-currency'))
        .CouponsCreditsReferralCurrencyWorkerModule,
    ],
  });
  registry = h.app.get(OutboxSubscriberRegistry, { strict: false });
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  opToken = token;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: hotp(base32Decode(setup.body.secret), totpStep(Date.now())) });
  const social = await api()
    .patch('/v2/platform/settings/social-captcha')
    .set(bearer(token))
    .send({ google: { enabled: true, clientId: 'cid', clientSecret: 'csecret' } });
  expect(social.status, JSON.stringify(social.body)).toBe(200);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});
afterEach(() => vi.restoreAllMocks());

describe('TW-CPN-029 referral code generation', () => {
  it('TW-CPN-029 a new user gets a 10-character code from the alphabet, issued from the sign-up event, unique across users', async () => {
    const a = await signup();
    expect(await rows(`SELECT 1 FROM referral_codes WHERE user_id = $1`, [a.userId])).toHaveLength(
      0,
    );
    await deliver([a.orgId], ['auth.signup_completed']);
    const [row] = await rows(
      `SELECT code FROM referral_codes WHERE owner_org_id = $1 AND user_id = $2`,
      [a.orgId, a.userId],
    );
    expect(row.code).toMatch(ALPHABET);

    const b = await signup();
    await deliver([b.orgId], ['auth.signup_completed']);
    const [other] = await rows(`SELECT code FROM referral_codes WHERE user_id = $1`, [b.userId]);
    expect(other.code).not.toBe(row.code);
  });

  it('TW-CPN-029 a user with an existing code never gets a new one: redelivery and the affiliate read keep it', async () => {
    const a = await signup();
    await deliver([a.orgId], ['auth.signup_completed']);
    const before = (await rows(`SELECT code FROM referral_codes WHERE user_id = $1`, [a.userId]))[0]
      .code;
    await deliver([a.orgId], ['auth.signup_completed'], true);
    expect(await codeOf(a)).toBe(before);
    expect(await codeOf(a)).toBe(before);
    expect(await rows(`SELECT 1 FROM referral_codes WHERE user_id = $1`, [a.userId])).toHaveLength(
      1,
    );
  });

  it('TW-CPN-029 a legacy user without a code gets one on the first affiliate read (the lazy backfill)', async () => {
    const a = await signup();
    expect(await rows(`SELECT 1 FROM referral_codes WHERE user_id = $1`, [a.userId])).toHaveLength(
      0,
    );
    const o = await overview(a);
    expect(o.code).toMatch(ALPHABET);
    expect(o.link).toBe(`http://localhost:3001/register?ref=${o.code}`);
  });

  it('TW-CPN-029 a collision on a drawn code draws again', async () => {
    const a = await signup();
    const b = await signup();
    const taken = await codeOf(a);
    // A random source that first reproduces a's code character by character, then draws freely.
    const digits = [...taken].map((ch) => REFERRAL_CODE_ALPHABET.indexOf(ch));
    let calls = 0;
    const rand = (max: number) => (calls < digits.length ? digits[calls++]! : (calls++ * 7) % max);
    const issued = await h.app
      .get(CpnStore, { strict: false })
      .tx((tx) =>
        h.app.get(ReferralCodeService, { strict: false }).ensureIn(tx, b.orgId, b.userId, rand),
      );
    expect(issued.created).toBe(true);
    expect(issued.code).not.toBe(taken);
    expect(issued.code).toMatch(ALPHABET);
    expect(calls).toBeGreaterThan(digits.length);
  });

  it('TW-CPN-029 concurrent first reads end with one code for the user', async () => {
    const a = await signup();
    const codes = await Promise.all(Array.from({ length: 6 }, () => codeOf(a)));
    expect(new Set(codes).size).toBe(1);
    expect(await rows(`SELECT 1 FROM referral_codes WHERE user_id = $1`, [a.userId])).toHaveLength(
      1,
    );
  });
});

describe('TW-CPN-031 and TW-CPN-032 attribution', () => {
  it("TW-CPN-032 B signs up with A's code (any case): one referral row, unpaid, code upper-cased", async () => {
    const a = await signup();
    const code = await codeOf(a);
    const b = await signup({ referralCode: code.toLowerCase() });
    await deliver([b.orgId], ['referral.attributed']);
    const ref = await referralOf(b.userId);
    expect(ref).toMatchObject({
      referrer_user_id: a.userId,
      referrer_org_id: a.orgId,
      referred_org_id: b.orgId,
      code_used: code,
      credits_awarded: 0,
      award_transaction_id: null,
    });
    expect(
      await rows(
        `SELECT 1 FROM audit_log WHERE module = 'referrals' AND record_id = $1 AND action = 'insert'`,
        [ref.id],
      ),
    ).toHaveLength(1);
  });

  it('TW-CPN-032 attribution delivered twice (at-least-once) still leaves one row', async () => {
    const a = await signup();
    const b = await signup({ referralCode: await codeOf(a) });
    await deliver([b.orgId], ['referral.attributed']);
    await deliver([b.orgId], ['referral.attributed'], true);
    expect(
      await rows(`SELECT 1 FROM referrals WHERE referred_user_id = $1`, [b.userId]),
    ).toHaveLength(1);
    const again = await h.app.get(ReferralAttributionService, { strict: false }).attribute({
      referrerUserUuid: a.userUuid,
      referrerOrgUuid: a.orgUuid,
      referredUserUuid: b.userUuid,
      referredOrgUuid: b.orgUuid,
      codeUsed: await codeOf(a),
    });
    expect(again).toBe('already_attributed');
  });

  it('TW-CPN-032 a user cannot be attributed to themselves (service and database both refuse)', async () => {
    const a = await signup();
    const code = await codeOf(a);
    const out = await h.app.get(ReferralAttributionService, { strict: false }).attribute({
      referrerUserUuid: a.userUuid,
      referrerOrgUuid: a.orgUuid,
      referredUserUuid: a.userUuid,
      referredOrgUuid: a.orgUuid,
      codeUsed: code,
    });
    expect(out).toBe('ignored');
    await expect(
      h.owner.query(
        `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used) VALUES ($1, $2, $1, $2, 'X')`,
        [a.orgId, a.userId],
      ),
    ).rejects.toThrow(/chk_referrals_not_self/);
  });

  it('TW-CPN-032 an event naming a code the referrer does not own records nothing', async () => {
    const a = await signup();
    await codeOf(a);
    const b = await signup();
    const out = await h.app.get(ReferralAttributionService, { strict: false }).attribute({
      referrerUserUuid: a.userUuid,
      referrerOrgUuid: a.orgUuid,
      referredUserUuid: b.userUuid,
      referredOrgUuid: b.orgUuid,
      codeUsed: 'NOTMYCODE2',
    });
    expect(out).toBe('ignored');
    expect(await referralOf(b.userId)).toBeUndefined();
  });

  it('TW-CPN-031 an unknown code lets sign-up succeed and records no referral', async () => {
    const b = await signup({ referralCode: 'ZZZZZZZZZZ' });
    await deliver([b.orgId], ['referral.attributed']);
    expect(await referralOf(b.userId)).toBeUndefined();
  });

  it('TW-CPN-031 the code survives the sign-up code step (staged sign-up carries it) and attributes once the account exists', async () => {
    // The staged path stores the same SignupData the direct path builds; the direct path is what runs here (no OTP sender
    // is configured in this harness), and the unit test of the staged payload lives with the auth domain.
    const a = await signup();
    const b = await signup({ referralCode: await codeOf(a) });
    await deliver([b.orgId], ['referral.attributed']);
    expect(await referralOf(b.userId)).toBeDefined();
  });

  it('TW-CPN-031 a social sign-up carries the referral code through the callback (Reference lost it)', async () => {
    const a = await signup();
    const code = await codeOf(a);
    const email = uniqueEmail('soc');
    h.socialProfiles.set('soc-ref', {
      subject: 'g-soc-ref',
      email,
      emailVerified: true,
      name: 'Soc Person',
      avatarUrl: null,
    });
    const start = await api().get('/v2/auth/social/google/start').query({
      redirectUri: 'http://localhost:3001/auth/social/google/callback',
      mode: 'signup',
      orgName: 'Social Ref Co',
    });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const state = new URL(start.body.url).searchParams.get('state')!;
    const done = await api()
      .post('/v2/auth/social/google/callback')
      .send({ state, code: 'soc-ref', referralCode: code });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    const created = await account(email, done.body.tokens.accessToken, done.body.orgSlug);
    await deliver([created.orgId], ['referral.attributed']);
    expect(await referralOf(created.userId)).toMatchObject({
      referrer_user_id: a.userId,
      code_used: code,
    });
  });
});

describe('TW-CPN-033 reward on the first paid order', () => {
  async function referred(): Promise<{ a: Account; b: Account }> {
    const a = await signup();
    const b = await signup({ referralCode: await codeOf(a) });
    await deliver([b.orgId], ['referral.attributed']);
    await setReward(100);
    return { a, b };
  }

  it("TW-CPN-033 the first paid order credits the referrer's workspace wallet once, stamps the referral, audits and emits referral.rewarded", async () => {
    const { a, b } = await referred();
    const before = await balance(a.orgId);
    await registry.dispatch(orderPaid(b.orgId));
    expect(await balance(a.orgId)).toBe(before + 100);
    const ref = await referralOf(b.userId);
    expect(ref.credits_awarded).toBe(100);
    expect(ref.award_transaction_id).not.toBeNull();
    const [tx] = await rows(
      `SELECT source, type, subject_type, subject_id, idempotency_key, user_id FROM wallet_transactions WHERE org_id = $1 AND id = $2`,
      [a.orgId, ref.award_transaction_id],
    );
    expect(tx).toMatchObject({
      source: 'referral.paid',
      type: 'earn',
      subject_type: 'referral',
      idempotency_key: `referral:${ref.id}`,
      user_id: a.userId,
    });
    expect(
      await rows(
        `SELECT 1 FROM audit_log WHERE module = 'referrals' AND record_id = $1 AND action = 'update'`,
        [ref.id],
      ),
    ).toHaveLength(1);
    const ev = await rows(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'referral.rewarded'`,
      [a.orgId],
    );
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ amountMinor: 100, currency: 'USD' });
  });

  it('TW-CPN-033 a second paid order pays nothing more', async () => {
    const { a, b } = await referred();
    await registry.dispatch(orderPaid(b.orgId));
    const after = await balance(a.orgId);
    await registry.dispatch(orderPaid(b.orgId));
    await registry.dispatch(orderPaid(b.orgId));
    expect(await balance(a.orgId)).toBe(after);
    expect(
      await rows(
        `SELECT 1 FROM wallet_transactions WHERE source = 'referral.paid' AND org_id = $1`,
        [a.orgId],
      ),
    ).toHaveLength(1);
  });

  it('TW-CPN-033 with the reward set to 0 nothing is paid, the referral stays unpaid, and a later order pays once the reward is set', async () => {
    const { a, b } = await referred();
    await setReward(0);
    await registry.dispatch(orderPaid(b.orgId));
    expect((await referralOf(b.userId)).award_transaction_id).toBeNull();
    expect(await balance(a.orgId)).toBe(0);
    await setReward(250);
    await registry.dispatch(orderPaid(b.orgId));
    expect((await referralOf(b.userId)).credits_awarded).toBe(250);
    expect(await balance(a.orgId)).toBe(250);
  });

  it('TW-CPN-033 an order from a workspace that was not referred does nothing', async () => {
    const c = await signup();
    await setReward(100);
    await registry.dispatch(orderPaid(c.orgId));
    expect(await balance(c.orgId)).toBe(0);
    expect(
      await rows(`SELECT 1 FROM wallet_transactions WHERE org_id = $1`, [c.orgId]),
    ).toHaveLength(0);
  });

  it('TW-CPN-033 two order.paid events delivered at the same moment credit the referrer once', async () => {
    const { a, b } = await referred();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => registry.dispatch(orderPaid(b.orgId))),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await balance(a.orgId)).toBe(100);
    expect(
      await rows(
        `SELECT 1 FROM wallet_transactions WHERE source = 'referral.paid' AND org_id = $1`,
        [a.orgId],
      ),
    ).toHaveLength(1);
    expect(
      await rows(
        `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'referral.rewarded'`,
        [a.orgId],
      ),
    ).toHaveLength(1);
  });

  it('TW-CPN-033 a wallet failure leaves the referral unpaid and is retried by the outbox (it cannot reach checkout, which never calls this)', async () => {
    const { a, b } = await referred();
    const ledger = h.app.get(WalletLedgerService, { strict: false });
    vi.spyOn(ledger, 'post').mockRejectedValueOnce(new Error('wallet unavailable'));
    await expect(registry.dispatch(orderPaid(b.orgId))).rejects.toThrow(/wallet unavailable/);
    expect((await referralOf(b.userId)).award_transaction_id).toBeNull();
    expect(await balance(a.orgId)).toBe(0);
    await registry.dispatch(orderPaid(b.orgId));
    expect(await balance(a.orgId)).toBe(100);
  });

  it('TW-CPN-033 a free (zero-total) paid order counts like any other (parity, recorded as a QUIRK)', async () => {
    const { a, b } = await referred();
    const free = orderPaid(b.orgId);
    await registry.dispatch({ ...free, payload: { ...free.payload, total: '0.00' } });
    expect(await balance(a.orgId)).toBe(100);
  });
});

describe('TW-CPN-037 the overview (account tab)', () => {
  it('TW-CPN-037 lists the 50 newest of 60 referrals and reports the true lifetime count (Reference capped it at 50)', async () => {
    const a = await signup();
    await seedReferrals(
      a,
      Array.from({ length: 60 }, (_, i) => ({
        name: `Ref ${i}`,
        email: `ov${Date.now()}${i}@x.test`,
        daysAgo: i % 20,
      })),
    );
    const o = await overview(a);
    expect(o.recent).toHaveLength(50);
    expect(o.lifetimeCount).toBe(60);
    expect(o.last30dCount).toBe(60);
    expect(o.recent.map((r) => r.createdAt)).toEqual(
      [...o.recent.map((r) => r.createdAt)].sort().reverse(),
    );
  });

  it('TW-CPN-037 a legacy user without a code still gets a real code, not a placeholder', async () => {
    const a = await signup();
    expect((await overview(a)).code).toMatch(ALPHABET);
  });

  it('TW-CPN-037 shows the configured reward in the platform currency (250 -> 2.50 USD), the same for every viewer', async () => {
    await setReward(250);
    const a = await signup();
    const b = await signup();
    for (const who of [a, b]) {
      const o = await overview(who);
      expect(o).toMatchObject({ rewardMinor: 250, currency: 'USD' });
    }
  });

  it('TW-CPN-037 a pending referral is shown pending, not "active" (Reference hard-coded active)', async () => {
    const a = await signup();
    await seedReferrals(a, [
      { name: 'Paid One', email: `pd${Date.now()}@x.test`, daysAgo: 1, paidMinor: 100 },
      { name: 'Pending One', email: `pn${Date.now()}@x.test`, daysAgo: 2 },
    ]);
    const o = await overview(a);
    expect(o.recent.map((r) => r.status)).toEqual(['paid', 'pending']);
    expect(o.earnedMinor).toBe(100);
  });
});

describe('TW-CPN-035 the history dashboard', () => {
  let a: Account;
  beforeAll(async () => {
    a = await signup();
    const gm = Array.from({ length: 12 }, (_, i) => ({
      name: `Gee ${i}`,
      email: `g${i}.${Date.now()}@gmail.com`,
      daysAgo: 1 + i,
    }));
    const other = Array.from({ length: 33 }, (_, i) => ({
      name: `Other ${i}`,
      email: `o${i}.${Date.now()}@mail.test`,
      daysAgo: 20 + (i % 60),
    }));
    await seedReferrals(a, [...gm, ...other]);
    await seedReferrals(a, [
      { name: 'Old Timer', email: `old${Date.now()}@mail.test`, daysAgo: 400 },
    ]);
  });

  it('TW-CPN-035 45 referrals in 90 days: page 1 has 20 rows, total 45, and the cursor walks 20 + 5 without repeats or gaps', async () => {
    const first = await list(a);
    expect(first.data).toHaveLength(20);
    expect(first.page).toMatchObject({ total: 45, hasMore: true, limit: 20 });
    const second = await list(a, `?cursor=${encodeURIComponent(first.page.nextCursor!)}`);
    expect(second.data).toHaveLength(20);
    const third = await list(a, `?cursor=${encodeURIComponent(second.page.nextCursor!)}`);
    expect(third.data).toHaveLength(5);
    expect(third.page.hasMore).toBe(false);
    const ids = [...first.data, ...second.data, ...third.data].map((r) => r.id);
    expect(new Set(ids).size).toBe(45);
    const times = [...first.data, ...second.data, ...third.data].map((r) => r.createdAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('TW-CPN-035 a search for "gmail" lists only matches (name, email or code) and leaves the KPIs unchanged', async () => {
    const all = await list(a);
    const hit = await list(a, '?q=gmail');
    expect(hit.page.total).toBe(12);
    expect(
      hit.data.every((r) => /gmail/i.test(`${r.refereeEmail}${r.refereeName}${r.codeUsed}`)),
    ).toBe(true);
    expect(hit.stats).toEqual(all.stats);
    const byName = await list(a, '?q=gee 1');
    expect(byName.data.length).toBeGreaterThan(0);
    const byCode = await list(a, `?q=${(await codeOf(a)).slice(2, 6).toLowerCase()}`);
    expect(byCode.page.total).toBe(45);
  });

  it('TW-CPN-035 search text is a literal: wildcards and quotes match nothing and break nothing', async () => {
    for (const q of ['%', '_', "'; DROP TABLE referrals; --", '\\']) {
      const res = await listRaw(a, `?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
      expect(res.body.page.total, q).toBe(0);
    }
  });

  it('TW-CPN-035 the default bucket follows the range (7d daily with 7 points, all monthly) and a named bucket is always honoured', async () => {
    const seven = await list(a, '?range=7d');
    expect(seven.filters).toMatchObject({ range: '7d', bucket: 'daily' });
    expect(seven.volume).toHaveLength(7);
    const all = await list(a, '?range=all');
    expect(all.filters.bucket).toBe('monthly');
    expect(all.page.total).toBe(46);
    const ninetyDefault = await list(a);
    expect(ninetyDefault.filters).toMatchObject({ range: '90d', bucket: 'weekly' });
    const ninetyDaily = await list(a, '?range=90d&bucket=daily');
    expect(ninetyDaily.filters.bucket).toBe('daily');
    expect(ninetyDaily.volume).toHaveLength(90);
    expect(ninetyDaily.volume.reduce((s, p) => s + p.signups, 0)).toBeGreaterThan(0);
  });

  it('TW-CPN-035 the stats are right: range, previous window, lifetime, 30 days, delta, top codes', async () => {
    const r = await list(a, '?range=30d');
    expect(r.stats.signupsLifetime).toBe(46);
    expect(r.stats.signupsInRange).toBe(await count(a, 30));
    expect(r.stats.signupsPrevious).toBe((await count(a, 60)) - (await count(a, 30)));
    expect(r.stats.deltaPercent).toBe(
      Math.round(
        ((r.stats.signupsInRange - r.stats.signupsPrevious) / r.stats.signupsPrevious) * 100,
      ),
    );
    expect(r.topCodes[0]).toMatchObject({ code: await codeOf(a), signups: r.stats.signupsInRange });
    expect(r.volume.reduce((s, p) => s + p.signups, 0)).toBeLessThanOrEqual(
      r.stats.signupsLifetime,
    );
  });

  it('TW-CPN-035 a referral without payout reads "pending" with no wallet entry; a paid one reads "paid" with the wallet entry id', async () => {
    const b = await signup();
    await seedReferrals(b, [
      { name: 'Paid', email: `s1${Date.now()}@x.test`, daysAgo: 1, paidMinor: 150 },
      { name: 'Unpaid', email: `s2${Date.now()}@x.test`, daysAgo: 2 },
    ]);
    const r = await list(b);
    const paid = r.data.find((x) => x.refereeName === 'Paid')!;
    const unpaid = r.data.find((x) => x.refereeName === 'Unpaid')!;
    expect(paid).toMatchObject({ status: 'paid', creditsAwardedMinor: 150 });
    expect(paid.walletTxId).toMatch(/^[0-9a-f-]{36}$/);
    expect(unpaid).toMatchObject({ status: 'pending', creditsAwardedMinor: 0, walletTxId: null });
    expect(r.stats).toMatchObject({
      creditsEarnedMinor: 150,
      signupsLifetime: 2,
      avgPerSignupMinor: 75,
    });
  });

  it('TW-CPN-035 recent payouts read the source the reward writes (referral.paid), newest first, in the same unit as the rest', async () => {
    const b = await signup();
    await seedReferrals(b, [
      { name: 'P1', email: `p1${Date.now()}@x.test`, daysAgo: 3, paidMinor: 100 },
      { name: 'P2', email: `p2${Date.now()}@x.test`, daysAgo: 2, paidMinor: 250 },
    ]);
    const r = await list(b);
    expect(r.payouts.map((p) => p.amountMinor)).toEqual([250, 100]);
    expect(r.payouts[0]!.balanceAfterMinor).toBe(350);
    expect(r.currency).toBe('USD');
  });

  it('TW-CPN-035 a user with no referrals sees zeros, a 0% delta and empty lists', async () => {
    const b = await signup();
    const r = await list(b);
    expect(r.stats).toMatchObject({
      signupsInRange: 0,
      signupsLifetime: 0,
      deltaPercent: 0,
      creditsEarnedMinor: 0,
      avgPerSignupMinor: 0,
    });
    expect(r.data).toEqual([]);
    expect(r.page).toMatchObject({ total: 0, hasMore: false, nextCursor: null });
    expect(r.topCodes).toEqual([]);
    expect(r.payouts).toEqual([]);
    expect(r.volume.every((p) => p.signups === 0)).toBe(true);
  });

  it('TW-CPN-035 an unauthenticated request is refused, and a bad range or bucket is a validation error', async () => {
    expect((await api().get('/v2/me/referrals')).status).toBe(401);
    expect((await listRaw(a, '?range=1y')).status).toBe(422);
    expect((await listRaw(a, '?bucket=hourly')).status).toBe(422);
    expect((await listRaw(a, '?cursor=garbage')).status).toBe(400);
    expect((await api().get('/v2/me/referral')).status).toBe(401);
  });

  it('TW-CPN-035 tenant scoping: another workspace, and another member of the SAME workspace, see none of these referrals', async () => {
    const outsider = await signup();
    const colleague = await addMember(a);
    for (const who of [outsider, colleague]) {
      const r = await list(who);
      expect(r.data).toEqual([]);
      expect(r.stats.signupsLifetime).toBe(0);
      expect(r.page.total).toBe(0);
      const o = await overview(who);
      expect(o.recent).toEqual([]);
      expect(o.code).not.toBe(await codeOf(a));
      const csv = (await exportCsv(who)).body as unknown as string;
      expect(csv.trim().split('\r\n')).toHaveLength(1);
    }
  });

  async function count(who: Account, days: number): Promise<number> {
    return Number(
      (
        await rows(
          `SELECT count(*)::int AS c FROM referrals WHERE referrer_user_id = $1 AND created_at >= now() - ($2 || ' days')::interval`,
          [who.userId, String(days)],
        )
      )[0].c,
    );
  }
});

describe('TW-CPN-036 the CSV export', () => {
  const BOM = String.fromCharCode(0xfeff);

  it('TW-CPN-036 exports a header and one row per referral in range, newest first, UTF-8 with a BOM and the agreed columns', async () => {
    const a = await signup();
    await seedReferrals(a, [
      { name: 'José Ñandú', email: `c1${Date.now()}@x.test`, daysAgo: 3 },
      { name: 'Mid', email: `c2${Date.now()}@x.test`, daysAgo: 2, paidMinor: 200 },
      { name: 'New', email: `c3${Date.now()}@x.test`, daysAgo: 1 },
    ]);
    const res = await exportCsv(a);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="affiliate-history-\d{8}-\d{6}\.csv"/,
    );
    const text = res.body as unknown as string;
    expect(text.startsWith(BOM)).toBe(true);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe(REFERRAL_CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(',New,');
    expect(lines[3]).toContain('José Ñandú');
    const mid = lines[2]!.split(',');
    expect(mid[5]).toBe('200');
    expect(mid[6]).toMatch(/^[0-9a-f-]{36}$/);
    expect(mid[1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('TW-CPN-036 range 7d exports only the last 7 days', async () => {
    const a = await signup();
    await seedReferrals(a, [
      { name: 'Recent', email: `r1${Date.now()}@x.test`, daysAgo: 2 },
      { name: 'Older', email: `r2${Date.now()}@x.test`, daysAgo: 20 },
    ]);
    const lines = ((await exportCsv(a, '?range=7d')).body as unknown as string)
      .trim()
      .split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Recent');
  });

  it('TW-CPN-036 a user without referrals gets only the header row', async () => {
    const a = await signup();
    const lines = ((await exportCsv(a)).body as unknown as string).slice(1).trim().split('\r\n');
    expect(lines).toEqual([REFERRAL_CSV_COLUMNS.join(',')]);
  });

  it('TW-CPN-036 a referee who named themselves like a formula cannot run it in a spreadsheet', async () => {
    const a = await signup();
    await seedReferrals(a, [
      { name: '=HYPERLINK("http://evil")', email: `f${Date.now()}@x.test`, daysAgo: 1 },
    ]);
    const text = (await exportCsv(a)).body as unknown as string;
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe('TW-CPN-034 the reward setting (wallet rules save, owned by the wallet domain)', () => {
  const save = (referralSignup: string) =>
    api().put('/v2/platform/wallet/settings').set(bearer(opToken)).send({
      flatPrice: '1.00',
      referralSignup,
      lowBalanceThreshold: '0.20',
      launchCoveragePercent: 100,
    });

  it('TW-CPN-034 2.50 is stored as 250 hundredths and read back as 2.50; the change is logged with the old and new value', async () => {
    const res = await save('2.50');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.referralSignupMinor).toBe(250);
    const logs = await api()
      .get('/v2/platform/wallet/logs?scope=platform&event=platform.settings.saved')
      .set(bearer(opToken));
    expect(JSON.stringify(logs.body)).toContain('referralSignupMinor');
    expect(JSON.stringify(logs.body)).toContain('250');
  });

  it('TW-CPN-034 a reward above 100,000 is refused, 100,000 itself and 0 are accepted', async () => {
    expect((await save('100001')).status).toBe(422);
    expect((await save('100000')).status).toBe(200);
    expect((await save('0')).status).toBe(200);
    await setReward(100);
  });
});
