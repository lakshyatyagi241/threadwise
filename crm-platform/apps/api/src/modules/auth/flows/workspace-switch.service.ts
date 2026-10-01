import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, type LoginResponse, type WorkspaceListResponse } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { TenantDirectory } from '../platform/tenant-directory';
import { AuthAuditService } from '../security/auth-audit.service';
import { LoginService, type ClientMeta } from './login.service';

/**
 * Workspace switch (WD-AUTH-010).
 *
 * Users are per-organization rows, so "the same person" in two organizations
 * means: the same email, verified in both. The current session
 * already proves control of the verified inbox, so no password is asked; but a
 * target account with MFA still produces a step-up challenge.
 */
@Injectable()
export class WorkspaceSwitchService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: TenantDirectory,
    private readonly login: LoginService,
    private readonly audit: AuthAuditService,
  ) {}

  private async currentIdentity(): Promise<{
    orgId: number;
    userId: number;
    email: string;
    orgSlug: string;
    verified: boolean;
  }> {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    const res = await this.db.txAs({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) =>
      tx.execute(sql`
        SELECT u.email, o.slug, s.email_verified_at
        FROM users u JOIN organizations o ON o.id = u.org_id
        LEFT JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
        WHERE u.org_id = ${ctx.orgId} AND u.id = ${ctx.userId}
      `),
    );
    const row = res.rows[0] as unknown as {
      email: string;
      slug: string;
      email_verified_at: Date | null;
    };
    return {
      orgId: ctx.orgId,
      userId: ctx.userId,
      email: row.email,
      orgSlug: row.slug,
      verified: Boolean(row.email_verified_at),
    };
  }

  async list(): Promise<WorkspaceListResponse> {
    const me = await this.currentIdentity();
    // An unverified address cannot be used to discover other workspaces.
    const others = me.verified ? await this.tenants.orgsForVerifiedEmail(me.email) : [];
    const items = new Map(
      others.map((o) => [o.slug, { slug: o.slug, name: o.name, current: o.slug === me.orgSlug }]),
    );
    if (!items.has(me.orgSlug)) {
      const org = await this.tenants.findOrgBySlug(me.orgSlug);
      if (org) items.set(me.orgSlug, { slug: org.slug, name: org.name, current: true });
    }
    return { data: [...items.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }

  async switch(orgSlug: string, meta: ClientMeta): Promise<LoginResponse> {
    const me = await this.currentIdentity();
    const unavailable = new AppError(
      ERROR_CODES.AUTH_WORKSPACE_NOT_AVAILABLE,
      'You cannot switch to that workspace.',
      HttpStatus.FORBIDDEN,
    );
    if (!me.verified) throw unavailable;

    const target = await this.tenants.findOrgBySlug(orgSlug);
    if (!target || target.status !== 'active' || target.id === me.orgId) throw unavailable;

    const allowed = await this.tenants.orgsForVerifiedEmail(me.email);
    if (!allowed.some((o) => o.slug === target.slug)) throw unavailable;

    const found = await this.db.txAs({ orgId: target.id }, async (tx) =>
      tx.execute(sql`
        SELECT u.id, u.uuid, u.email, u.full_name, COALESCE(s.mfa_enabled, false) AS mfa_enabled
        FROM users u LEFT JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
        WHERE u.org_id = ${target.id} AND u.email = ${me.email} AND u.status = 'active'
      `),
    );
    const user = found.rows[0] as unknown as
      | { id: number; uuid: string; email: string; full_name: string; mfa_enabled: boolean }
      | undefined;
    if (!user) throw unavailable;

    await this.audit.recordStandalone({
      event: 'workspace.entered',
      status: 'success',
      orgId: target.id,
      actorType: 'user',
      actorId: user.id,
      recordId: user.id,
      payload: { fromOrg: me.orgSlug, toOrg: target.slug },
    });

    if (user.mfa_enabled) {
      return this.login.issueMfaChallenge({
        orgId: target.id,
        userId: user.id,
        remember: false,
        method: 'switch',
      });
    }
    return this.login.completeLogin({
      org: target,
      user: { id: user.id, uuid: user.uuid, email: user.email, fullName: user.full_name },
      remember: false,
      mfaVerified: false,
      method: 'switch',
      meta,
    });
  }
}
