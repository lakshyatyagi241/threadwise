import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The referral tables against a real Postgres as the restricted application role (a superuser would bypass every policy):
 * `referrals` and `referral_codes` are platform data behind the privileged flag, so a workspace sees none of them whatever the
 * rows say, and the integrity rules (one referrer per referee, no self-referral, one code per user) hold even for a writer that
 * skips the service. Constraint checks use the owner connection (owners skip RLS, never CHECK or UNIQUE).
 */
describe('referral tables: RLS and integrity (migration 20261031100000)', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;

  async function inTx<T>(setup: string[], fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      for (const s of setup) await app.query(s);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  const asOrg = <T>(id: number, fn: () => Promise<T>) =>
    inTx([`SELECT set_config('app.org_id', '${id}', true)`], fn);
  const privileged = <T>(fn: () => Promise<T>) =>
    inTx([`SELECT set_config('app.privileged', 'on', true)`], fn);

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    const org = async (slug: string) =>
      Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            slug,
          ])
        ).rows[0].id,
      );
    const user = async (orgId: number, email: string) =>
      Number(
        (
          await owner.query(
            `INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, 'U') RETURNING id`,
            [orgId, email],
          )
        ).rows[0].id,
      );
    orgA = await org('ref-org-a');
    orgB = await org('ref-org-b');
    userA = await user(orgA, 'a@ref.test');
    userB = await user(orgB, 'b@ref.test');
    await owner.query(
      `INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES ($1, $2, 'ABCDEFGHJK')`,
      [orgA, userA],
    );
    await owner.query(
      `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used)
       VALUES ($1, $2, $3, $4, 'ABCDEFGHJK')`,
      [orgA, userA, orgB, userB],
    );
    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
  }, 180_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  it('RLS: a workspace sees no referral and no referral code, its own included', async () => {
    for (const org of [orgA, orgB]) {
      await asOrg(org, async () => {
        expect((await app.query(`SELECT * FROM referrals`)).rowCount).toBe(0);
        expect((await app.query(`SELECT * FROM referral_codes`)).rowCount).toBe(0);
      });
    }
    await privileged(async () => {
      expect((await app.query(`SELECT * FROM referrals`)).rowCount).toBe(1);
      expect((await app.query(`SELECT * FROM referral_codes`)).rowCount).toBe(1);
    });
  });

  it('RLS: a workspace cannot write a referral or a code, for itself or for another workspace', async () => {
    await asOrg(orgA, async () => {
      await expect(
        app.query(
          `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used) VALUES ($1, $2, $3, 999, 'X')`,
          [orgA, userA, orgB],
        ),
      ).rejects.toThrow(/row-level security/);
    });
    await asOrg(orgA, async () => {
      await expect(
        app.query(
          `INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES ($1, 1, 'ZZZZZZZZZZ')`,
          [orgA],
        ),
      ).rejects.toThrow(/row-level security/);
    });
    await asOrg(orgA, async () => {
      expect((await app.query(`UPDATE referrals SET credits_awarded = 999`)).rowCount).toBe(0);
    });
  });

  it('RLS and FORCE are on for both tables', async () => {
    const r = await owner.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('referrals', 'referral_codes') ORDER BY relname`,
    );
    expect(r.rows).toEqual([
      { relname: 'referral_codes', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'referrals', relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it('WD-CPN-032 one referrer per referee: a second referral for the same user is refused', async () => {
    await expect(
      owner.query(
        `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used) VALUES ($1, $2, $3, $4, 'Y')`,
        [orgA, userA, orgB, userB],
      ),
    ).rejects.toThrow(/uq_referrals_referred_user_id/);
  });

  it('WD-CPN-032 nobody is their own referrer, and a reward cannot be negative', async () => {
    await expect(
      owner.query(
        `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used) VALUES ($1, $2, $1, $2, 'X')`,
        [orgA, userA],
      ),
    ).rejects.toThrow(/chk_referrals_not_self/);
    await expect(owner.query(`UPDATE referrals SET credits_awarded = -1`)).rejects.toThrow(
      /chk_referrals_credits_nonneg/,
    );
  });

  it('WD-CPN-029 a user has one code and a code belongs to one user', async () => {
    await expect(
      owner.query(
        `INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES ($1, $2, 'QQQQQQQQQQ')`,
        [orgA, userA],
      ),
    ).rejects.toThrow(/uq_referral_codes_owner_user/);
    await expect(
      owner.query(
        `INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES ($1, $2, 'ABCDEFGHJK')`,
        [orgB, userB],
      ),
    ).rejects.toThrow(/uq_referral_codes_code/);
  });

  it('a referral must name real workspaces', async () => {
    await expect(
      owner.query(
        `INSERT INTO referrals (referrer_org_id, referrer_user_id, referred_org_id, referred_user_id, code_used) VALUES (999999, 1, $1, 12345, 'X')`,
        [orgB],
      ),
    ).rejects.toThrow(/fk_referrals_referrer_org_id/);
  });

  it('the history list and the unpaid lookup are served by their indexes', async () => {
    const r = await owner.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'referrals' ORDER BY indexname`,
    );
    expect(r.rows.map((x) => x.indexname)).toEqual(
      expect.arrayContaining([
        'idx_referrals_referrer_history',
        'idx_referrals_referred_org_unpaid',
      ]),
    );
  });
});
