import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  DELETE_CONFIRMATION_PHRASE,
  ERROR_CODES,
  resolveTimezone,
  type BrandingResponse,
  type ChangePasswordRequest,
  type DeleteAccountRequest,
  type ProfileResponse,
  type SessionListResponse,
  type SessionListQuery,
  type SessionResponse,
  type UpdateBrandingRequest,
  type UpdateProfileRequest,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { PersonaService } from '../../persona';
import { LoginService } from '../flows/login.service';
import { MailService } from '../mail/mail.service';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { SessionService } from '../sessions/session.service';
import { AccountGateService } from '../security/account-gate.service';
import { AuthAuditService } from '../security/auth-audit.service';
import {
  bustFooterCache,
  pickFooter,
  platformFooterFrom,
  readSavedPlatformFooter,
} from '../security/branding-footer.service';
import { PasswordService } from '../security/password.service';
import { UploadPolicyService } from '../security/upload-policy.service';
import { Ttl } from '../support/redis-keys';
import { isValidTimezone } from '../support/text';
import { TokenService } from '../token.service';
import { PlanFeatureGate } from './plan-feature-gate';

interface ProfileRow {
  email: string;
  full_name: string;
  uuid: string;
  status: string;
  display_name: string | null;
  phone_e164: string | null;
  locale: string | null;
  timezone: string | null;
  theme: 'paper' | 'bright' | 'dark' | null;
  email_verified_at: Date | null;
  mfa_enabled: boolean | null;
  avatar_etag: string | null;
  org_uuid: string;
  org_slug: string;
  org_name: string;
  org_plan: string;
  org_settings: Record<string, unknown>;
  is_admin: boolean;
  is_owner: boolean;
  /** The workspace names an owner (sign-up does; seeded and admin-created workspaces may not). */
  has_owner: boolean;
}

export const AVATAR_MAX_BYTES = 1024 * 1024;

/**
 * Who may change the workspace timezone (Reference: the owner only, anyone else is
 * silently ignored). A workspace that records no owner has nobody the rule can
 * name, so there its administrators stand in rather than leaving it frozen.
 */
export function canEditWorkspaceTimezone(p: {
  is_owner: boolean;
  has_owner: boolean;
  is_admin: boolean;
}): boolean {
  return p.is_owner || (!p.has_owner && p.is_admin);
}

/**
 * Self-service account operations (TW-AUTH-024..029): the session probe the web
 * shell boots from, profile, avatar, change password, delete account, message
 * footer and the device list. Every method acts on the caller; there is no
 * "other user" parameter anywhere in this class.
 */
@Injectable()
export class AccountService {
  private readonly appName: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly rbac: RbacService,
    private readonly login: LoginService,
    private readonly gates: AccountGateService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly audit: AuthAuditService,
    private readonly mail: MailService,
    private readonly outbox: OutboxService,
    private readonly uploads: UploadPolicyService,
    private readonly settings: PlatformSettingsService,
    private readonly planGate: PlanFeatureGate,
    private readonly tokens: TokenService,
    private readonly policy: SecurityPolicyService,
    private readonly persona: PersonaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.appName = config.get('APP_NAME', { infer: true });
  }

  private actor(): { orgId: number; userId: number; sessionId?: string } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    return { orgId: ctx.orgId, userId: ctx.userId, sessionId: ctx.sessionId };
  }

  private async loadProfile(orgId: number, userId: number): Promise<ProfileRow> {
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        SELECT u.email, u.full_name, u.uuid, u.status,
               p.display_name, p.phone_e164, p.locale, p.timezone, p.theme,
               s.email_verified_at, s.mfa_enabled,
               a.etag AS avatar_etag,
               o.uuid AS org_uuid, o.slug AS org_slug, o.name AS org_name, o.plan AS org_plan,
               o.settings AS org_settings,
               EXISTS (
                 SELECT 1 FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
                 WHERE ur.org_id = u.org_id AND ur.user_id = u.id AND r.system_key IN ('admin', 'workspace_admin')
               ) AS is_admin,
               COALESCE((o.settings ->> 'ownerUserId') = u.uuid::text, false) AS is_owner,
               (o.settings ->> 'ownerUserId') IS NOT NULL AS has_owner
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        LEFT JOIN user_profiles p ON p.org_id = u.org_id AND p.user_id = u.id
        LEFT JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
        LEFT JOIN user_avatars a ON a.org_id = u.org_id AND a.user_id = u.id
        WHERE u.org_id = ${orgId} AND u.id = ${userId}
      `),
    );
    const row = res.rows[0] as unknown as ProfileRow | undefined;
    if (!row) throw AppError.unauthenticated();
    return row;
  }

  /** The platform's default currency (General settings), or null when none is saved. Never throws. */
  private async platformCurrency(): Promise<string | null> {
    try {
      const general = await this.settings.get<{ defaultCurrency?: unknown }>('set.general');
      const code = general?.defaultCurrency;
      return typeof code === 'string' && /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : null;
    } catch {
      return null;
    }
  }

  // --- session probe -------------------------------------------------------------------------------------------

  async sessionInfo(): Promise<SessionResponse> {
    const { orgId, userId, sessionId } = this.actor();
    const [p, state, grants, rolesRes, personaView, platformCurrency] = await Promise.all([
      this.loadProfile(orgId, userId),
      this.gates.stateFor(orgId, userId),
      this.rbac.grantsForUser(orgId, userId),
      this.db.txAs({ orgId, userId }, async (tx) =>
        tx.execute(sql`
          SELECT r.uuid, r.name FROM user_roles ur
          JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
          WHERE ur.org_id = ${orgId} AND ur.user_id = ${userId} ORDER BY r.name
        `),
      ),
      // Never throws: an unknown persona is `null`, and nothing is hidden on a guess.
      this.persona.resolve(orgId),
      this.platformCurrency(),
    ]);

    const permissions: Record<string, 'all' | 'team' | 'team_and_below' | 'own'> = {};
    for (const [key, grant] of grants) {
      if (grant.effect === 'allow') permissions[key] = grant.scope;
    }

    const settings = p.org_settings as {
      onboardingStep?: 'workspace' | 'plan' | 'done';
      timezone?: string;
      currency?: string;
      messageFooter?: string | null;
    };

    return {
      user: {
        id: p.uuid,
        email: p.email,
        fullName: p.full_name,
        displayName: p.display_name,
        phone: p.phone_e164,
        locale: p.locale,
        timezone: p.timezone,
        theme: p.theme ?? 'paper',
        avatarUrl: p.avatar_etag ? `/api/v2/account/avatar?v=${p.avatar_etag}` : null,
        emailVerified: Boolean(p.email_verified_at),
        mfaEnabled: p.mfa_enabled ?? false,
      },
      org: {
        id: p.org_uuid,
        slug: p.org_slug,
        name: p.org_name,
        plan: p.org_plan,
        timezone: settings.timezone ?? null,
        // A workspace that never chose a currency is billed in the platform's, so every screen shows that one (never a made-up $).
        currency: settings.currency ?? platformCurrency,
        messageFooter: settings.messageFooter ?? null,
        onboardingStep: settings.onboardingStep ?? 'done',
        ...(personaView ? { persona: personaView } : {}),
      },
      roles: (rolesRes.rows as unknown as Array<{ uuid: string; name: string }>).map((r) => ({
        id: r.uuid,
        name: r.name,
      })),
      permissions,
      landing: await this.login.landingFor(
        { id: orgId, settings: p.org_settings },
        userId,
        p.is_admin,
      ),
      flags: this.gates.toFlags(state),
      sessionId: sessionId ?? '',
      effectiveTimezone: resolveTimezone([p.timezone, settings.timezone]),
    };
  }

  // --- profile ----------------------------------------------------------------------------------------------------

  async getProfile(): Promise<ProfileResponse> {
    const { orgId, userId } = this.actor();
    const p = await this.loadProfile(orgId, userId);
    const pending = await this.db.txAs({ orgId, userId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT payload ->> 'newEmail' AS new_email FROM user_tokens
        WHERE org_id = ${orgId} AND user_id = ${userId} AND kind = 'email_change'
          AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1
      `);
      return (res.rows[0] as unknown as { new_email: string } | undefined)?.new_email ?? null;
    });
    const settings = p.org_settings as { timezone?: string };
    return {
      fullName: p.full_name,
      displayName: p.display_name,
      email: p.email,
      emailVerified: Boolean(p.email_verified_at),
      pendingEmail: pending,
      phone: p.phone_e164,
      locale: p.locale,
      timezone: p.timezone,
      effectiveTimezone: resolveTimezone([p.timezone, settings.timezone]),
      theme: p.theme ?? 'paper',
      avatarUrl: p.avatar_etag ? `/api/v2/account/avatar?v=${p.avatar_etag}` : null,
      avatarMaxBytes: AVATAR_MAX_BYTES,
      workspaceTimezone: settings.timezone ?? null,
      canEditWorkspaceTimezone: canEditWorkspaceTimezone(p),
    };
  }

  async updateProfile(body: UpdateProfileRequest): Promise<ProfileResponse> {
    const { orgId, userId } = this.actor();
    const p = await this.loadProfile(orgId, userId);

    // Only the owner changes the workspace timezone. For anyone else the field is
    // dropped without an error (Reference) and the unchanged value comes back, so the
    // rest of a profile save still goes through.
    const mayEditTimezone = canEditWorkspaceTimezone(p);
    const timezoneIgnored = body.workspaceTimezone !== undefined && !mayEditTimezone;
    const newTimezone = mayEditTimezone ? body.workspaceTimezone : undefined;
    if (newTimezone !== undefined && !isValidTimezone(newTimezone)) {
      throw AppError.validation('Unknown timezone', [
        { path: 'workspaceTimezone', message: 'Not an IANA timezone.' },
      ]);
    }

    if (body.timezone && !isValidTimezone(body.timezone)) {
      throw AppError.validation('Unknown timezone', [
        { path: 'timezone', message: 'Not an IANA timezone.' },
      ]);
    }

    await this.db.txAs({ orgId, userId }, async (tx) => {
      if (body.fullName !== undefined) {
        await tx.execute(
          sql`UPDATE users SET full_name = ${body.fullName} WHERE org_id = ${orgId} AND id = ${userId}`,
        );
      }
      const phoneChanged = body.phone !== undefined && body.phone !== p.phone_e164;
      await tx.execute(sql`
        INSERT INTO user_profiles (org_id, user_id, display_name, phone_e164, locale, timezone, theme)
        VALUES (${orgId}, ${userId}, ${body.displayName ?? null}, ${body.phone ?? null}, ${body.locale ?? null}, ${body.timezone ?? null}, ${body.theme ?? 'paper'})
        ON CONFLICT (org_id, user_id) DO UPDATE SET
          display_name = ${body.displayName === undefined ? sql`user_profiles.display_name` : sql`${body.displayName || null}`},
          phone_e164   = ${body.phone === undefined ? sql`user_profiles.phone_e164` : sql`${body.phone}`},
          phone_verified_at = ${phoneChanged ? sql`NULL` : sql`user_profiles.phone_verified_at`},
          locale       = ${body.locale === undefined ? sql`user_profiles.locale` : sql`${body.locale}`},
          timezone     = ${body.timezone === undefined ? sql`user_profiles.timezone` : sql`${body.timezone}`},
          theme        = ${body.theme === undefined ? sql`user_profiles.theme` : sql`${body.theme}`}
      `);
      if (newTimezone !== undefined) {
        await tx.execute(sql`
          UPDATE organizations SET settings = settings || ${JSON.stringify({ timezone: newTimezone })}::jsonb
          WHERE id = ${orgId}
        `);
      }
      const fields = Object.keys(body).filter(
        (k) => !(timezoneIgnored && k === 'workspaceTimezone'),
      );
      await this.audit.record(tx, {
        event: 'auth.profile_updated',
        status: 'success',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: { fields, ...(timezoneIgnored ? { workspaceTimezoneIgnored: true } : {}) },
      });
      // Reference drops an in-app "Profile updated" notification here; NOTIF consumes this.
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'auth',
        aggregateId: userId,
        eventType: 'auth.user.profile_updated',
        payload: { userUuid: p.uuid, fields },
      });
    });
    return this.getProfile();
  }

  // --- avatar ------------------------------------------------------------------------------------------------------------

  async setAvatar(file: { originalname: string; buffer: Buffer }): Promise<{ avatarUrl: string }> {
    const { orgId, userId } = this.actor();
    const checked = this.uploads.validate({
      filename: file.originalname,
      buffer: file.buffer,
      allow: ['image'],
      maxBytes: AVATAR_MAX_BYTES,
    });
    // SVG is blocked by the policy; bmp/tiff are legal elsewhere but not an avatar.
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(checked.mime)) {
      throw new AppError(
        ERROR_CODES.AUTH_UPLOAD_REJECTED,
        'Use a JPG, PNG, WebP or GIF image.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const etag = createHash('sha1').update(file.buffer).digest('hex').slice(0, 16);
    await this.db.txAs({ orgId, userId }, async (tx) => {
      await tx.execute(sql`
        INSERT INTO user_avatars (org_id, user_id, mime, bytes, etag)
        VALUES (${orgId}, ${userId}, ${checked.mime}, ${file.buffer}, ${etag})
        ON CONFLICT (org_id, user_id) DO UPDATE
          SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, etag = EXCLUDED.etag, updated_at = now()
      `);
      await this.audit.record(tx, {
        event: 'auth.avatar_updated',
        status: 'success',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
      });
    });
    return { avatarUrl: `/api/v2/account/avatar?v=${etag}` };
  }

  async removeAvatar(): Promise<void> {
    const { orgId, userId } = this.actor();
    await this.db.txAs({ orgId, userId }, async (tx) => {
      await tx.execute(
        sql`DELETE FROM user_avatars WHERE org_id = ${orgId} AND user_id = ${userId}`,
      );
      await this.audit.record(tx, {
        event: 'auth.avatar_removed',
        status: 'info',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
      });
    });
  }

  async readAvatar(): Promise<{ mime: string; bytes: Buffer; etag: string } | null> {
    const { orgId, userId } = this.actor();
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(
        sql`SELECT mime, bytes, etag FROM user_avatars WHERE org_id = ${orgId} AND user_id = ${userId}`,
      ),
    );
    return (
      (res.rows[0] as unknown as { mime: string; bytes: Buffer; etag: string } | undefined) ?? null
    );
  }

  // --- password --------------------------------------------------------------------------------------------------------------

  async changePassword(body: ChangePasswordRequest): Promise<{ revokedOtherSessions: number }> {
    const { orgId, userId, sessionId } = this.actor();
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(
        sql`SELECT uuid, email, full_name, password_hash FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
      ),
    );
    const row = res.rows[0] as unknown as {
      uuid: string;
      email: string;
      full_name: string;
      password_hash: string | null;
    };

    if (!(await this.passwords.verifyOrDummy(row.password_hash, body.currentPassword))) {
      throw new AppError(
        ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG,
        'The password you entered is not correct.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'currentPassword', message: 'Incorrect.' }],
      );
    }
    await this.passwords.assertAcceptable(body.newPassword, {
      email: row.email,
      fullName: row.full_name,
      field: 'newPassword',
    });
    // Same-password changes defeat the point of a forced change.
    if (await this.passwords.verifyOrDummy(row.password_hash, body.newPassword)) {
      throw AppError.validation('Choose a password you have not used on this account.', [
        { path: 'newPassword', message: 'Must differ from the current password.' },
      ]);
    }

    const hash = await this.passwords.hash(body.newPassword);
    await this.db.txAs({ orgId, userId }, async (tx) => {
      await tx.execute(
        sql`UPDATE users SET password_hash = ${hash} WHERE org_id = ${orgId} AND id = ${userId}`,
      );
      await tx.execute(sql`
        INSERT INTO user_security (org_id, user_id, password_changed_at, force_password_change)
        VALUES (${orgId}, ${userId}, now(), false)
        ON CONFLICT (org_id, user_id) DO UPDATE SET password_changed_at = now(), force_password_change = false
      `);
      await this.audit.record(tx, {
        event: 'auth.password_changed',
        status: 'success',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
      });
      // An urgent in-app notice ("Password changed"): if this was not the person,
      // it is the one that tells them. NOTIF consumes it.
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'auth',
        aggregateId: userId,
        eventType: 'auth.user.password_changed',
        payload: { userUuid: row.uuid, urgent: true },
      });
    });

    const revoked = await this.sessions.revokeAllForUser(
      orgId,
      userId,
      'password_changed',
      sessionId,
    );
    await this.gates.invalidate(orgId, userId);
    void this.mail.sendPasswordChanged(
      row.email,
      row.full_name,
      this.mail.link('/forgot-password', {}),
    );
    return { revokedOtherSessions: revoked };
  }

  // --- delete account ---------------------------------------------------------------------------------------------------------

  async deleteAccount(body: DeleteAccountRequest): Promise<void> {
    const { orgId, userId, sessionId } = this.actor();
    if (body.confirmation !== DELETE_CONFIRMATION_PHRASE) {
      throw new AppError(
        ERROR_CODES.AUTH_CONFIRMATION_MISMATCH,
        `Type "${DELETE_CONFIRMATION_PHRASE}" exactly to confirm.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        SELECT u.email, u.password_hash,
          (SELECT count(*)::int FROM users x WHERE x.org_id = u.org_id AND x.status = 'active') AS active_users,
          (SELECT count(*)::int FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
             JOIN users x ON x.org_id = ur.org_id AND x.id = ur.user_id
            WHERE ur.org_id = u.org_id AND r.system_key = 'admin' AND x.status = 'active') AS active_admins,
          EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id
            WHERE ur.org_id = u.org_id AND ur.user_id = u.id AND r.system_key = 'admin') AS is_admin
        FROM users u WHERE u.org_id = ${orgId} AND u.id = ${userId}
      `),
    );
    const row = res.rows[0] as unknown as {
      email: string;
      password_hash: string | null;
      active_users: number;
      active_admins: number;
      is_admin: boolean;
    };

    if (!(await this.passwords.verifyOrDummy(row.password_hash, body.password))) {
      throw new AppError(
        ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG,
        'The password you entered is not correct.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // Blockers, stated precisely. Reference orphaned solo-owned workspaces and its
    // copy promised data deletion that did not happen.
    if (row.active_users <= 1) {
      throw new AppError(
        ERROR_CODES.AUTH_DELETE_BLOCKED,
        'You are the only member of this workspace, so the account cannot be deleted on its own. Ask the platform team to close the workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'reason', message: 'sole_member' }],
      );
    }
    if (row.is_admin && row.active_admins <= 1) {
      throw new AppError(
        ERROR_CODES.AUTH_DELETE_BLOCKED,
        'You are the only administrator. Make someone else an administrator first.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'reason', message: 'sole_admin' }],
      );
    }

    // Hard delete, and the audit row is the record. It is written in
    // the same transaction, before the row disappears.
    await this.db.txAs({ orgId, userId }, async (tx) => {
      await this.audit.record(tx, {
        event: 'auth.account_deleted',
        status: 'info',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: { email: row.email },
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'auth',
        aggregateId: userId,
        eventType: 'auth.user.deleted',
        payload: { email: row.email },
      });
      await tx.execute(sql`
        UPDATE organizations SET settings = settings - 'ownerUserId'
        WHERE id = ${orgId} AND settings ->> 'ownerUserId' = (SELECT uuid::text FROM users WHERE org_id = ${orgId} AND id = ${userId})
      `);
      await tx.execute(sql`DELETE FROM users WHERE org_id = ${orgId} AND id = ${userId}`);
    });
    if (sessionId) await this.sessions.tombstone(sessionId);
    await this.gates.invalidate(orgId, userId);
  }

  // --- branding (message footer) ------------------------------------------------------------------------------------------------

  async getBranding(): Promise<BrandingResponse> {
    const { orgId, userId } = this.actor();
    const p = await this.loadProfile(orgId, userId);
    const own = (p.org_settings as { messageFooter?: string | null }).messageFooter ?? null;
    const canEdit = await this.planGate.has(orgId, 'remove_branding');
    const platform = platformFooterFrom(await readSavedPlatformFooter(this.settings), this.appName);
    return {
      messageFooter: own,
      platformDefault: platform ?? '',
      canEdit,
      // The same table the send path uses, so the screen shows what goes out.
      effective: pickFooter({ removesBranding: canEdit, own, platform }),
    };
  }

  async updateBranding(body: UpdateBrandingRequest): Promise<BrandingResponse> {
    const { orgId, userId } = this.actor();
    // 422 PLAN_FEATURE_LOCKED with the feature key and the upgrade path (TW-PLAN-017).
    await this.planGate.assert(
      orgId,
      'remove_branding',
      'Your plan does not include removing branding.',
    );
    // null clears the saved text; '' is a deliberate "no footer".
    await this.db.txAs({ orgId, userId }, async (tx) => {
      if (body.messageFooter === null) {
        await tx.execute(
          sql`UPDATE organizations SET settings = settings - 'messageFooter' WHERE id = ${orgId}`,
        );
      } else {
        await tx.execute(sql`
          UPDATE organizations SET settings = settings || ${JSON.stringify({ messageFooter: body.messageFooter })}::jsonb
          WHERE id = ${orgId}
        `);
      }
      await this.audit.record(tx, {
        event: 'auth.branding_footer_updated',
        status: 'success',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
      });
      // The send pipelines read the footer through BrandingFooterService, which
      // drops its cached copy on this event.
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: 'organizations',
        aggregateId: orgId,
        eventType: 'org.branding_footer.changed',
        payload: { messageFooter: body.messageFooter },
      });
    });
    // Right after commit, so the next send anywhere already sees it; the outbox
    // event above is the backstop if this call is lost.
    await bustFooterCache(this.redis, orgId);
    return this.getBranding();
  }

  // --- devices -----------------------------------------------------------------------------------------------------------------------------

  async listSessions(query: SessionListQuery): Promise<SessionListResponse> {
    const { orgId, userId, sessionId } = this.actor();
    const [page, policy] = await Promise.all([
      this.sessions.listPage(orgId, userId, sessionId, query),
      this.policy.policy(),
    ]);
    const remember = this.tokens.refreshTtlSeconds();
    return {
      ...page,
      meta: {
        sessionLifetimeSeconds: Math.min(Ttl.sessionNoRememberSeconds, remember),
        rememberLifetimeSeconds: remember,
        idleTimeoutMinutes: policy.sessionTimeoutMinutes,
      },
    };
  }

  async revokeSession(targetUuid: string): Promise<void> {
    const { orgId, userId, sessionId } = this.actor();
    this.sessions.assertOwnSessionTarget(sessionId, targetUuid);
    // Ownership is part of the lookup: another user's session id is "not found",
    // never "forbidden", so ids cannot be probed.
    if (!(await this.sessions.belongsToUser(orgId, userId, targetUuid))) {
      throw new AppError(
        ERROR_CODES.AUTH_SESSION_NOT_FOUND,
        'Session not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.sessions.revoke(orgId, targetUuid, 'revoked_by_user');
    await this.audit.recordStandalone({
      event: 'auth.session_revoked',
      status: 'success',
      orgId,
      actorType: 'user',
      actorId: userId,
      recordId: userId,
      payload: { sessionId: targetUuid },
    });
  }

  async revokeOtherSessions(): Promise<number> {
    const { orgId, userId, sessionId } = this.actor();
    const count = await this.sessions.revokeAllForUser(orgId, userId, 'revoked_by_user', sessionId);
    await this.audit.recordStandalone({
      event: 'auth.all_sessions_revoked',
      status: 'success',
      orgId,
      actorType: 'user',
      actorId: userId,
      recordId: userId,
      payload: { count },
    });
    return count;
  }
}
