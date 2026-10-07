import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { PlanEntitlementService, type InitialPlan } from '../../plans-subscriptions-trials';

export interface OrgRef {
  id: number;
  uuid: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  settings: Record<string, unknown>;
}

export interface ProvisionInput {
  orgName: string;
  slug: string;
  fullName: string;
  email: string;
  passwordHash: string;
  phoneE164: string | null;
  /** The number was proven by a one-time code at sign-up. */
  phoneVerified: boolean;
  /** null = unverified (mail goes out); a date = verified at sign-up (OTP, social). */
  emailVerifiedAt: Date | null;
  locale: string | null;
  orgSettings: Record<string, unknown>;
  /** The registration policy: the plan slug it names (null = none) and the free-trial length in days. */
  signupPlan: { defaultPlanSlug: string | null; trialDays: number };
}

export interface ProvisionResult {
  org: { id: number; uuid: string; slug: string; name: string };
  user: { id: number; uuid: string };
  adminRoleId: number;
  /** The plan and trial the organization started with (TW-AUTH-008 rules 1 and 2). */
  plan: InitialPlan;
}

/**
 * Cross-tenant operations the auth flows cannot avoid. Each method is one fixed statement or transaction with
 * parameterised inputs; none accepts SQL from a caller.
 *
 *   findOrgBySlug / orgsForVerifiedEmail   identity directory (login, switch)
 *   provisionOrganization                  sign-up: no tenant exists yet
 *   forceResetAllUsers / revokeAllSessions operator danger actions
 *
 * Only this file and platform-store.ts may call `.privileged(` in the auth
 * module.
 */
@Injectable()
export class TenantDirectory {
  constructor(
    private readonly db: DatabaseService,
    private readonly plans: PlanEntitlementService,
  ) {}

  /** Exact slug first; falls back to a case-insensitive match only when it is unambiguous. */
  async findOrgBySlug(slug: string): Promise<OrgRef | null> {
    return this.db.privileged(async (tx) => {
      const exact = await tx.execute(sql`
        SELECT id, uuid, slug, name, status, plan, settings FROM organizations WHERE slug = ${slug}
      `);
      if (exact.rows[0]) return exact.rows[0] as unknown as OrgRef;
      const loose = await tx.execute(sql`
        SELECT id, uuid, slug, name, status, plan, settings FROM organizations
        WHERE lower(slug) = lower(${slug}) LIMIT 2
      `);
      return loose.rows.length === 1 ? (loose.rows[0] as unknown as OrgRef) : null;
    });
  }

  /** Active organizations where `email` belongs to an active, email-verified user. */
  async orgsForVerifiedEmail(email: string): Promise<Array<{ slug: string; name: string }>> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT o.slug, o.name
        FROM users u
        JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
        JOIN organizations o ON o.id = u.org_id
        WHERE u.email = ${email}
          AND u.status = 'active'
          AND s.email_verified_at IS NOT NULL
          AND o.status = 'active'
        ORDER BY o.name
      `);
      return res.rows as unknown as Array<{ slug: string; name: string }>;
    });
  }

  /** Active organizations holding an active user with this email (login without a workspace). Capped: nobody has more. */
  async activeOrgsForEmail(email: string): Promise<OrgRef[]> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT o.id, o.uuid, o.slug, o.name, o.status, o.plan, o.settings
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        WHERE u.email = ${email} AND u.status = 'active' AND o.status = 'active'
        ORDER BY o.name, o.id
        LIMIT 20
      `);
      return res.rows as unknown as OrgRef[];
    });
  }

  /** What a workspace card shows: the person's role there and how many people are in it. */
  async workspaceCardDetails(
    pairs: Array<{ orgId: number; userId: number }>,
  ): Promise<Map<number, { role: string | null; memberCount: number }>> {
    const out = new Map<number, { role: string | null; memberCount: number }>();
    await this.db.privileged(async (tx) => {
      for (const { orgId, userId } of pairs) {
        const res = await tx.execute(sql`
          SELECT
            (SELECT r.name FROM user_roles ur
               JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
              WHERE ur.org_id = ${orgId} AND ur.user_id = ${userId}
              ORDER BY r.is_locked DESC, r.name LIMIT 1) AS role,
            (SELECT count(*)::int FROM users WHERE org_id = ${orgId} AND status = 'active') AS member_count
        `);
        const r = res.rows[0] as { role: string | null; member_count: number } | undefined;
        out.set(orgId, { role: r?.role ?? null, memberCount: r?.member_count ?? 0 });
      }
    });
    return out;
  }

  async slugExists(slug: string): Promise<boolean> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(
        sql`SELECT 1 FROM organizations WHERE lower(slug) = lower(${slug}) LIMIT 1`,
      );
      return res.rows.length > 0;
    });
  }

  /**
   * Creates the organization, its five workspace preset roles (the locked Owner
   * holds every capability key), the first user, that user's security/profile
   * rows and the organization's plan (the registration default, plus a free
   * trial when the plan is free) in ONE transaction. `inTx` runs inside it so
   * the caller can write the audit row and outbox event atomically with the
   * data.
   */
  async provisionOrganization(
    input: ProvisionInput,
    inTx: (tx: Tx, result: ProvisionResult) => Promise<void>,
  ): Promise<ProvisionResult> {
    return this.db.privileged(async (tx) => {
      // The PLAN domain decides the plan (4-step resolution) and the trial; this
      // domain only stores the answer, in the same transaction as the org.
      const plan = await this.plans.resolveInitialPlan(tx, {
        registrationDefaultSlug: input.signupPlan.defaultPlanSlug,
        trialDays: input.signupPlan.trialDays,
      });
      let orgRow: { id: number; uuid: string };
      try {
        const res = await tx.execute(sql`
          INSERT INTO organizations (slug, name, plan, settings)
          VALUES (${input.slug}, ${input.orgName}, ${plan.planSlug}, ${JSON.stringify(input.orgSettings)}::jsonb)
          RETURNING id, uuid
        `);
        orgRow = res.rows[0] as unknown as { id: number; uuid: string };
      } catch (err) {
        // drizzle wraps the driver error: the SQLSTATE is on `cause` there
        const e = err as { code?: string; cause?: { code?: string } };
        if (e.code === '23505' || e.cause?.code === '23505') {
          throw new AppError(
            ERROR_CODES.AUTH_SLUG_TAKEN,
            'That workspace address is already taken.',
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      }
      const orgId = orgRow.id;
      await this.plans.recordInitialState(tx, orgId, plan);

      // The five workspace presets (Owner, Admin, Manager, Agent, Viewer) and their grants come from one SQL function, the same one the
      // RBAC migration ran for every existing organization. The first user is the Owner (the locked top preset).
      const ownerRole = await tx.execute(sql`SELECT provision_workspace_presets(${orgId}) AS id`);
      const adminRoleId = Number((ownerRole.rows[0] as unknown as { id: number | string }).id);

      const userRes = await tx.execute(sql`
        INSERT INTO users (org_id, email, full_name, password_hash)
        VALUES (${orgId}, ${input.email}, ${input.fullName}, ${input.passwordHash})
        RETURNING id, uuid
      `);
      const user = userRes.rows[0] as unknown as { id: number; uuid: string };

      await tx.execute(sql`
        INSERT INTO user_roles (org_id, user_id, role_id) VALUES (${orgId}, ${user.id}, ${adminRoleId})
      `);
      await tx.execute(sql`
        INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at)
        VALUES (${orgId}, ${user.id}, ${input.emailVerifiedAt}, now())
      `);
      await tx.execute(sql`
        INSERT INTO user_profiles (org_id, user_id, phone_e164, phone_verified_at, locale)
        VALUES (${orgId}, ${user.id}, ${input.phoneE164},
                ${input.phoneE164 && input.phoneVerified ? new Date() : null}, ${input.locale})
      `);
      await tx.execute(sql`
        UPDATE organizations
        SET settings = settings || ${JSON.stringify({ ownerUserId: user.uuid })}::jsonb
        WHERE id = ${orgId}
      `);

      const result: ProvisionResult = {
        org: { id: orgId, uuid: orgRow.uuid, slug: input.slug, name: input.orgName },
        user,
        adminRoleId,
        plan,
      };
      await inTx(tx, result);
      return result;
    });
  }

  /** TW-AUTH-039: every user must pick a new password at next login. Returns users flagged. */
  async forceResetAllUsers(): Promise<number> {
    return this.db.privileged(async (tx) => {
      // user_security rows are created on demand, so make sure every active
      // user has one before flagging, or users without a row would be skipped.
      await tx.execute(sql`
        INSERT INTO user_security (org_id, user_id)
        SELECT org_id, id FROM users
        ON CONFLICT (org_id, user_id) DO NOTHING
      `);
      const res = await tx.execute(sql`
        UPDATE user_security SET force_password_change = true
        WHERE force_password_change = false
        RETURNING 1
      `);
      return res.rows.length;
    });
  }

  /** Revokes every live tenant session (the operator epoch bump covers outstanding access tokens). */
  async revokeAllTenantSessions(): Promise<number> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'revoke_all'
        WHERE revoked_at IS NULL
        RETURNING 1
      `);
      return res.rows.length;
    });
  }

  /** Counts for the security overview that need to look across tenants. */
  async userTotals(): Promise<{ users: number; mfaEnrolled: number }> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT count(*)::int AS users,
               count(*) FILTER (WHERE s.mfa_enabled)::int AS enrolled
        FROM users u
        LEFT JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
        WHERE u.status = 'active'
      `);
      const row = res.rows[0] as unknown as { users: number; enrolled: number };
      return { users: row.users, mfaEnrolled: row.enrolled };
    });
  }
}
