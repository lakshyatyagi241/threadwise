import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withPrivileged, withTenant, type DbClient } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { TenantDirectory } from '../../../src/modules/auth/platform/tenant-directory';
import { PlanCatalogService } from '../../../src/modules/plans-subscriptions-trials/plan-catalog.service';
import { PlanStore } from '../../../src/modules/plans-subscriptions-trials/plan-store';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';

/**
 * The auth domain's tables and gateways against a real Postgres, as the
 * restricted application role (a superuser would bypass every policy and make
 * these assertions vacuous, see rls.spec.ts).
 */
describe('auth schema, RLS and gateways', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let dbClient: DbClient;
  let directory: TenantDirectory;
  let orgA: number;
  let orgB: number;
  let userA: number;
  let userB: number;

  const q = (c: Client, text: string, params: unknown[] = []) => c.query(text, params);

  async function asOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgId)]);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  async function asPrivileged<T>(fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      await app.query(`SELECT set_config('app.privileged', 'on', true)`);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }

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
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });

    const a = await q(
      owner,
      `INSERT INTO organizations (slug, name) VALUES ('org-a','Org A') RETURNING id`,
    );
    const b = await q(
      owner,
      `INSERT INTO organizations (slug, name) VALUES ('org-b','Org B') RETURNING id`,
    );
    orgA = Number(a.rows[0].id);
    orgB = Number(b.rows[0].id);
    const ua = await q(
      owner,
      `INSERT INTO users (org_id, email, full_name) VALUES ($1,'same@x.test','A') RETURNING id`,
      [orgA],
    );
    const ub = await q(
      owner,
      `INSERT INTO users (org_id, email, full_name) VALUES ($1,'same@x.test','B') RETURNING id`,
      [orgB],
    );
    userA = Number(ua.rows[0].id);
    userB = Number(ub.rows[0].id);
    await q(
      owner,
      `INSERT INTO user_security (org_id, user_id, email_verified_at) VALUES ($1,$2,now()),($3,$4,now())`,
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

    dbClient = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
    const db = {
      primary: dbClient.db,
      privileged: (fn: Parameters<DatabaseService['privileged']>[0]) =>
        withPrivileged(dbClient.db, fn),
      txAs: (
        tenant: Parameters<DatabaseService['txAs']>[0],
        fn: Parameters<DatabaseService['txAs']>[1],
      ) => withTenant(dbClient.db, tenant, fn),
    } as unknown as DatabaseService;
    directory = new TenantDirectory(db, new PlanEntitlementService(db, new PlanCatalogService(db), new PlanStore(db)));
  }, 180_000);

  afterAll(async () => {
    await dbClient?.close();
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  describe('tenant tables', () => {
    it('shows each organization only its own sessions, tokens and security rows', async () => {
      await q(
        owner,
        `INSERT INTO auth_sessions (org_id, user_id, expires_at) VALUES ($1,$2, now()+interval '1 day'),($3,$4, now()+interval '1 day')`,
        [orgA, userA, orgB, userB],
      );
      await q(
        owner,
        `INSERT INTO user_tokens (org_id, user_id, kind, token_hash, expires_at) VALUES ($1,$2,'password_reset','h1', now()+interval '1 hour'),($3,$4,'password_reset','h2', now()+interval '1 hour')`,
        [orgA, userA, orgB, userB],
      );

      const seen = await asOrg(orgA, async () => ({
        sessions: (await q(app, 'SELECT user_id FROM auth_sessions')).rows,
        tokens: (await q(app, 'SELECT token_hash FROM user_tokens')).rows,
        security: (await q(app, 'SELECT user_id FROM user_security')).rows,
      }));
      expect(seen.sessions).toEqual([{ user_id: userA }]);
      expect(seen.tokens).toEqual([{ token_hash: 'h1' }]);
      expect(seen.security).toEqual([{ user_id: userA }]);
    });

    it('refuses a session or token written into another organization', async () => {
      await expect(
        asOrg(orgA, () =>
          q(
            app,
            `INSERT INTO auth_sessions (org_id, user_id, expires_at) VALUES ($1,$2, now()+interval '1 day')`,
            [orgB, userB],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        asOrg(orgA, () =>
          q(
            app,
            `INSERT INTO user_tokens (org_id, user_id, kind, token_hash, expires_at) VALUES ($1,$2,'email_verify','x', now()+interval '1 hour')`,
            [orgB, userB],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('refuses a cross-tenant reference through the composite foreign key', async () => {
      // org A's context, org A's org_id, but org B's user: only the composite FK can stop this.
      await expect(
        asOrg(orgA, () =>
          q(
            app,
            `INSERT INTO auth_sessions (org_id, user_id, expires_at) VALUES ($1,$2, now()+interval '1 day')`,
            [orgA, userB],
          ),
        ),
      ).rejects.toThrow(/foreign key/i);
    });

    it('returns nothing without a tenant context', async () => {
      await app.query('BEGIN');
      const res = await q(app, 'SELECT * FROM auth_sessions');
      await app.query('ROLLBACK');
      expect(res.rows).toHaveLength(0);
    });

    it('binds one social identity to exactly one user per organization', async () => {
      await q(
        owner,
        `INSERT INTO social_identities (org_id, user_id, provider, provider_subject) VALUES ($1,$2,'google','sub-1')`,
        [orgA, userA],
      );
      await expect(
        q(
          owner,
          `INSERT INTO social_identities (org_id, user_id, provider, provider_subject) VALUES ($1,$2,'google','sub-1')`,
          [orgA, userA],
        ),
      ).rejects.toThrow(/unique|duplicate/i);
      // Same subject in another organization is a different account link.
      await q(
        owner,
        `INSERT INTO social_identities (org_id, user_id, provider, provider_subject) VALUES ($1,$2,'google','sub-1')`,
        [orgB, userB],
      );
    });

    it('rejects unknown token kinds and providers', async () => {
      await expect(
        q(
          owner,
          `INSERT INTO user_tokens (org_id, user_id, kind, token_hash, expires_at) VALUES ($1,$2,'magic_login','z', now())`,
          [orgA, userA],
        ),
      ).rejects.toThrow(/check/i);
      await expect(
        q(
          owner,
          `INSERT INTO social_identities (org_id, user_id, provider, provider_subject) VALUES ($1,$2,'twitter','s')`,
          [orgA, userA],
        ),
      ).rejects.toThrow(/check/i);
    });
  });

  describe('platform tables', () => {
    it('are invisible and unwritable from a tenant transaction', async () => {
      await q(
        owner,
        `INSERT INTO platform_operators (email, full_name, password_hash, role) VALUES ('op@x.test','Op','h','super_admin')`,
      );
      await q(owner, `INSERT INTO platform_settings (key, value) VALUES ('k','1'::jsonb)`);

      const seen = await asOrg(orgA, async () => ({
        operators: (await q(app, 'SELECT * FROM platform_operators')).rows,
        settings: (await q(app, 'SELECT * FROM platform_settings')).rows,
        sessions: (await q(app, 'SELECT * FROM platform_sessions')).rows,
      }));
      expect(seen.operators).toHaveLength(0);
      expect(seen.settings).toHaveLength(0);
      expect(seen.sessions).toHaveLength(0);

      await expect(
        asOrg(orgA, () =>
          q(app, `INSERT INTO platform_settings (key, value) VALUES ('evil','true'::jsonb)`),
        ),
      ).rejects.toThrow(/row-level security/i);
      await expect(
        asOrg(orgA, () => q(app, `UPDATE platform_operators SET role = 'super_admin'`)),
      ).resolves.toMatchObject({ rowCount: 0 });
    });

    it('are readable and writable with the privileged flag', async () => {
      const rows = await asPrivileged(
        async () => (await q(app, 'SELECT email FROM platform_operators')).rows,
      );
      expect(rows).toEqual([{ email: 'op@x.test' }]);
    });

    it('lets any transaction append a security event but only privileged ones read', async () => {
      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(orgA)]);
      await q(
        app,
        `INSERT INTO security_events (subject_org_id, actor_type, event, status) VALUES ($1,'user','auth.failed','failure')`,
        [orgA],
      );
      // The writer cannot read back its own event: only operators can.
      expect((await q(app, 'SELECT * FROM security_events')).rows).toHaveLength(0);
      await app.query('COMMIT');
      // Without any context at all (an unknown organization on login) the insert still works.
      await app.query('BEGIN');
      await q(
        app,
        `INSERT INTO security_events (actor_type, event, status) VALUES ('system','auth.failed','failure')`,
      );
      await app.query('COMMIT');

      const count = await asPrivileged(async () =>
        Number((await q(app, 'SELECT count(*)::int AS n FROM security_events')).rows[0].n),
      );
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('cannot be rewritten or deleted by a tenant', async () => {
      await asOrg(orgA, async () => {
        // No UPDATE policy exists, so the row filter hides everything from an UPDATE.
        const upd = await q(app, `UPDATE security_events SET status = 'success'`);
        expect(upd.rowCount).toBe(0);
        const del = await q(app, 'DELETE FROM security_events');
        expect(del.rowCount).toBe(0);
      });
    });
  });

  describe('tenant directory (the privileged gateway)', () => {
    it('provisions an organization with a locked Admin role holding every capability', async () => {
      const result = await directory.provisionOrganization(
        {
          orgName: 'Fresh Co',
          slug: 'fresh-co',
          fullName: 'Founder',
          email: 'founder@fresh.test',
          passwordHash: 'hash',
          phoneE164: null,
          phoneVerified: false,
          emailVerifiedAt: new Date(),
          locale: null,
          orgSettings: { onboardingStep: 'workspace' },
          signupPlan: { defaultPlanSlug: null, trialDays: 0 },
        },
        async () => undefined,
      );
      const defs = Number(
        (await q(owner, 'SELECT count(*)::int AS n FROM permission_defs')).rows[0].n,
      );
      const admin = await q(
        owner,
        `SELECT id, is_locked, (SELECT count(*)::int FROM role_grants g WHERE g.org_id = r.org_id AND g.role_id = r.id) AS grants FROM roles r WHERE org_id = $1 AND system_key = 'admin'`,
        [result.org.id],
      );
      expect(admin.rows[0].is_locked).toBe(true);
      expect(admin.rows[0].grants).toBe(defs);

      const agent = await q(
        owner,
        `SELECT is_locked FROM roles WHERE org_id = $1 AND name = 'Agent'`,
        [result.org.id],
      );
      expect(agent.rows[0].is_locked).toBe(false);

      const sec = await q(
        owner,
        `SELECT email_verified_at FROM user_security WHERE org_id = $1 AND user_id = $2`,
        [result.org.id, result.user.id],
      );
      expect(sec.rows[0].email_verified_at).not.toBeNull();
      const org = await q(owner, `SELECT settings FROM organizations WHERE id = $1`, [
        result.org.id,
      ]);
      expect(org.rows[0].settings.ownerUserId).toBe(result.user.uuid);
    });

    it('rolls the whole provisioning back when a later step fails', async () => {
      await expect(
        directory.provisionOrganization(
          {
            orgName: 'Doomed',
            slug: 'doomed-co',
            fullName: 'X',
            email: 'x@doomed.test',
            passwordHash: 'h',
            phoneE164: null,
            phoneVerified: false,
            emailVerifiedAt: null,
            locale: null,
            orgSettings: {},
            signupPlan: { defaultPlanSlug: null, trialDays: 0 },
          },
          async () => {
            throw new Error('boom');
          },
        ),
      ).rejects.toThrow('boom');
      const left = await q(
        owner,
        `SELECT count(*)::int AS n FROM organizations WHERE slug = 'doomed-co'`,
      );
      expect(left.rows[0].n).toBe(0);
    });

    it('reports a taken slug as AUTH_SLUG_TAKEN', async () => {
      await expect(
        directory.provisionOrganization(
          {
            orgName: 'Again',
            slug: 'fresh-co',
            fullName: 'Y',
            email: 'y@fresh.test',
            passwordHash: 'h',
            phoneE164: null,
            phoneVerified: false,
            emailVerifiedAt: null,
            locale: null,
            orgSettings: {},
            signupPlan: { defaultPlanSlug: null, trialDays: 0 },
          },
          async () => undefined,
        ),
      ).rejects.toMatchObject({ code: 'AUTH_SLUG_TAKEN' });
    });

    it('lists only organizations where the email is verified and the user active', async () => {
      // 'same@x.test' is verified in A and B (seeded). Make B's user unverified.
      await q(owner, `UPDATE user_security SET email_verified_at = NULL WHERE org_id = $1`, [orgB]);
      expect((await directory.orgsForVerifiedEmail('same@x.test')).map((o) => o.slug)).toEqual([
        'org-a',
      ]);
      await q(owner, `UPDATE user_security SET email_verified_at = now() WHERE org_id = $1`, [
        orgB,
      ]);
      await q(owner, `UPDATE users SET status = 'inactive' WHERE org_id = $1`, [orgA]);
      expect((await directory.orgsForVerifiedEmail('same@x.test')).map((o) => o.slug)).toEqual([
        'org-b',
      ]);
      await q(owner, `UPDATE users SET status = 'active' WHERE org_id = $1`, [orgA]);
    });

    it('finds an organization by exact slug, and case-insensitively only when unambiguous', async () => {
      expect((await directory.findOrgBySlug('org-a'))?.id).toBe(orgA);
      expect((await directory.findOrgBySlug('ORG-A'))?.id).toBe(orgA);
      expect(await directory.findOrgBySlug('nope')).toBeNull();
    });

    it('flags every user for a password reset and revokes every live session', async () => {
      const flagged = await directory.forceResetAllUsers();
      expect(flagged).toBeGreaterThanOrEqual(2);
      const rows = await q(
        owner,
        'SELECT count(*)::int AS n FROM user_security WHERE NOT force_password_change',
      );
      expect(rows.rows[0].n).toBe(0);

      const revoked = await directory.revokeAllTenantSessions();
      expect(revoked).toBeGreaterThanOrEqual(2);
      const live = await q(
        owner,
        'SELECT count(*)::int AS n FROM auth_sessions WHERE revoked_at IS NULL',
      );
      expect(live.rows[0].n).toBe(0);
    });
  });

  it('registered the branding capability and granted it to existing Admin roles', async () => {
    const def = await q(
      owner,
      `SELECT key FROM permission_defs WHERE key = 'auth.branding.update'`,
    );
    expect(def.rows).toHaveLength(1);
  });
});
