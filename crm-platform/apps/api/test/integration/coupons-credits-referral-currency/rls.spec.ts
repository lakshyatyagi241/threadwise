import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, OWNER_URL } from '../bsp-billing-engine/live-db';

/**
 * The CPN tables against the real migrated schema, as the restricted application role (a superuser bypasses every policy, which
 * would make these assertions vacuous). Platform tables (coupons, currencies, credit packages) are readable or closed to tenants by
 * design; referrals and referral codes are visible to the tenant that owns the referrer only; nothing is writable without the
 * platform's privileged mode.
 */
describe('CPN tables: isolation, constraints and cascades', () => {
  let owner: Client;
  let app: Client;
  const orgs: number[] = [];
  const users: Array<{ org: number; id: number }> = [];
  let a: { org: number; user: number };
  let b: { org: number; user: number };
  const stamp = Date.now();

  const asOrg = async <T>(
    orgId: number | null,
    fn: () => Promise<T>,
    privileged = false,
  ): Promise<T> => {
    await app.query('BEGIN');
    try {
      if (orgId !== null)
        await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      if (privileged) await app.query(`SELECT set_config('app.privileged', 'on', true)`);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };

  async function mkOrg(label: string) {
    const o = Number(
      (
        await owner.query(
          `INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, 'starter') RETURNING id`,
          [`cpnrls-${label}-${stamp}`],
        )
      ).rows[0].id,
    );
    orgs.push(o);
    const u = Number(
      (
        await owner.query(
          `INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id`,
          [o, `${label}${stamp}@cpn.test`, label],
        )
      ).rows[0].id,
    );
    users.push({ org: o, id: u });
    return { org: o, user: u };
  }

  beforeAll(async () => {
    owner = new Client({ connectionString: OWNER_URL });
    app = new Client({ connectionString: APP_URL });
    await Promise.all([owner.connect(), app.connect()]);
    a = await mkOrg('a');
    b = await mkOrg('b');
    await owner.query(`INSERT INTO coupons (code, type, amount) VALUES ('CPNRLS1', 'percent', 5)`);
    await owner.query(
      `INSERT INTO currencies (name, code, symbol) VALUES ('Rls Test', 'RLS', 'r') ON CONFLICT (code) DO NOTHING`,
    );
    await owner.query(
      `INSERT INTO credit_packages (name, slug, price_minor, credits) VALUES ('Rls pack', 'cpnrls-pack', 100, 100)`,
    );
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM coupons WHERE code LIKE 'CPNRLS%'`);
    await owner.query(`DELETE FROM currencies WHERE code = 'RLS'`);
    await owner.query(`DELETE FROM credit_packages WHERE slug LIKE 'cpnrls-%'`);
    if (orgs.length) await owner.query(`DELETE FROM organizations WHERE id = ANY($1)`, [orgs]);
    await Promise.all([owner.end(), app.end()]);
  });

  it('the application role is neither a superuser nor able to bypass RLS', async () => {
    const r = await app.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('RLS is enabled AND forced on every table', async () => {
    const t = await owner.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1) ORDER BY relname`,
      [['coupons', 'credit_packages', 'currencies', 'referral_codes', 'referrals']],
    );
    expect(t.rows).toHaveLength(5);
    for (const r of t.rows)
      expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);
  });

  it('coupons are closed to a tenant (the resolver reads them on the privileged connection) and open to the platform', async () => {
    expect((await asOrg(a.org, () => app.query(`SELECT 1 FROM coupons`))).rowCount).toBe(0);
    expect((await asOrg(null, () => app.query(`SELECT 1 FROM coupons`))).rowCount).toBe(0);
    expect(
      (await asOrg(null, () => app.query(`SELECT 1 FROM coupons WHERE code = 'CPNRLS1'`), true))
        .rowCount,
    ).toBe(1);
  });

  it('currencies and credit packages are readable by anyone, writable only by the platform', async () => {
    expect(
      (await asOrg(a.org, () => app.query(`SELECT 1 FROM currencies WHERE code = 'RLS'`))).rowCount,
    ).toBe(1);
    expect(
      (
        await asOrg(a.org, () =>
          app.query(`SELECT 1 FROM credit_packages WHERE slug = 'cpnrls-pack'`),
        )
      ).rowCount,
    ).toBe(1);
    await expect(
      asOrg(a.org, () => app.query(`INSERT INTO currencies (name, code) VALUES ('x', 'RLX')`)),
    ).rejects.toThrow(/row-level security/);
    // an UPDATE the policy hides matches no row: nothing changes and nothing is reported
    expect(
      (await asOrg(a.org, () => app.query(`UPDATE currencies SET symbol = 'z' WHERE code = 'RLS'`)))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await asOrg(a.org, () =>
          app.query(`DELETE FROM credit_packages WHERE slug = 'cpnrls-pack'`),
        )
      ).rowCount,
    ).toBe(0);
    await expect(
      asOrg(a.org, () =>
        app.query(
          `INSERT INTO credit_packages (name, slug, price_minor, credits) VALUES ('x', 'cpnrls-x', 1, 1)`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asOrg(a.org, () =>
        app.query(`INSERT INTO coupons (code, type, amount) VALUES ('CPNRLS2', 'fixed', 1)`),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("a referrer sees their own workspace's referrals only, and no tenant can write one", async () => {
    await owner.query(
      `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used) VALUES ($1, $2, $3, $4, 'ABCD1234')`,
      [a.org, a.user, b.org, b.user],
    );
    expect((await asOrg(a.org, () => app.query(`SELECT 1 FROM referrals`))).rowCount).toBe(1);
    expect((await asOrg(b.org, () => app.query(`SELECT 1 FROM referrals`))).rowCount).toBe(0);
    expect((await asOrg(null, () => app.query(`SELECT 1 FROM referrals`))).rowCount).toBe(0);
    await expect(
      asOrg(a.org, () =>
        app.query(
          `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used) VALUES ($1, $2, $3, $4, 'X')`,
          [a.org, a.user, b.org, b.user],
        ),
      ),
    ).rejects.toThrow(/row-level security|duplicate key/);
  });

  it("a user's referral code is visible to their workspace only, and written only by the platform", async () => {
    await owner.query(
      `INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES ($1, $2, 'RLSCODEA01')`,
      [a.org, a.user],
    );
    expect((await asOrg(a.org, () => app.query(`SELECT 1 FROM referral_codes`))).rowCount).toBe(1);
    expect((await asOrg(b.org, () => app.query(`SELECT 1 FROM referral_codes`))).rowCount).toBe(0);
    await expect(
      asOrg(b.org, () =>
        app.query(
          `INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES ($1, $2, 'RLSCODEB01')`,
          [b.org, b.user],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('constraints: one code per user and per code; a coupon code is case-folded and bounded; types and windows are checked', async () => {
    await expect(
      owner.query(
        `INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES ($1, $2, 'RLSCODEA02')`,
        [a.org, a.user],
      ),
    ).rejects.toThrow(/uq_referral_codes_user/);
    await expect(
      owner.query(
        `INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES ($1, $2, 'RLSCODEA01')`,
        [b.org, b.user],
      ),
    ).rejects.toThrow(/uq_referral_codes_code/);
    await expect(
      owner.query(
        `INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES ($1, $2, 'bad code')`,
        [b.org, b.user],
      ),
    ).rejects.toThrow(/chk_referral_codes_code/);
    await expect(
      owner.query(`INSERT INTO coupons (code, type, amount) VALUES ('cpnrlslow', 'percent', 1)`),
    ).rejects.toThrow(/chk_coupons_code/);
    await expect(
      owner.query(`INSERT INTO coupons (code, type, amount) VALUES ('CPNRLS1', 'percent', 1)`),
    ).rejects.toThrow(/uq_coupons_code/);
    await expect(
      owner.query(`INSERT INTO coupons (code, type, amount) VALUES ('CPNRLS3', 'bogus', 1)`),
    ).rejects.toThrow(/chk_coupons_type/);
    await expect(
      owner.query(
        `INSERT INTO coupons (code, type, amount, max_uses) VALUES ('CPNRLS3', 'fixed', 1, 0)`,
      ),
    ).rejects.toThrow(/chk_coupons_max_uses/);
    await expect(
      owner.query(
        `INSERT INTO coupons (code, type, amount, starts_at, expires_at) VALUES ('CPNRLS3', 'fixed', 1, now(), now() - interval '1 day')`,
      ),
    ).rejects.toThrow(/chk_coupons_window/);
    await expect(
      owner.query(`INSERT INTO currencies (name, code, exchange_rate) VALUES ('x', 'rlsx', 1)`),
    ).rejects.toThrow(/chk_currencies_code/);
    await expect(
      owner.query(`INSERT INTO currencies (name, code, exchange_rate) VALUES ('x', 'RLY', 0)`),
    ).rejects.toThrow(/chk_currencies_rate/);
    await expect(
      owner.query(`INSERT INTO currencies (name, code, "precision") VALUES ('x', 'RLZ', 9)`),
    ).rejects.toThrow(/chk_currencies_precision/);
    await expect(
      owner.query(
        `INSERT INTO credit_packages (name, slug, price_minor, credits) VALUES ('x', 'cpnrls-y', 1, 0)`,
      ),
    ).rejects.toThrow(/chk_credit_packages_credits/);
  });

  it('a referral points at real users in both workspaces and goes when either user goes (cascade), not into a cross-tenant hole', async () => {
    const c = Number(
      (
        await owner.query(
          `INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'c') RETURNING id`,
          [b.org, `c${stamp}@cpn.test`],
        )
      ).rows[0].id,
    );
    // user ids are global, so (a.org, b's user) is no user: the composite key refuses the cross-tenant pointer
    await expect(
      owner.query(
        `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used) VALUES ($1, $2, $3, $4, 'Z')`,
        [a.org, b.user, b.org, c],
      ),
    ).rejects.toThrow(/fk_referrals_referrer/);
    await expect(
      owner.query(
        `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used) VALUES ($1, $2, $3, $4, 'Z')`,
        [a.org, a.user, a.org, a.user],
      ),
    ).rejects.toThrow(/chk_referrals_distinct/);
    expect(
      Number(
        (
          await owner.query(`SELECT count(*)::int AS n FROM referrals WHERE referrer_org_id = $1`, [
            a.org,
          ])
        ).rows[0].n,
      ),
    ).toBe(1);
    await owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [b.org, b.user]);
    expect(
      Number(
        (
          await owner.query(`SELECT count(*)::int AS n FROM referrals WHERE referrer_org_id = $1`, [
            a.org,
          ])
        ).rows[0].n,
      ),
    ).toBe(0);
  });

  it("deleting a workspace removes its users' codes and referrals (the draft's RESTRICT would have blocked it)", async () => {
    expect(
      Number(
        (
          await owner.query(
            `SELECT count(*)::int AS n FROM referral_codes WHERE owner_org_id = $1`,
            [a.org],
          )
        ).rows[0].n,
      ),
    ).toBe(1);
    await owner.query(`DELETE FROM organizations WHERE id = $1`, [a.org]);
    expect(
      Number(
        (
          await owner.query(
            `SELECT count(*)::int AS n FROM referral_codes WHERE owner_org_id = $1`,
            [a.org],
          )
        ).rows[0].n,
      ),
    ).toBe(0);
  });
});
