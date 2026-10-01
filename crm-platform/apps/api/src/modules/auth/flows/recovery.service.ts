import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type ChangeEmailRequest,
  type FindWorkspacesRequest,
  type ForgotPasswordRequest,
  type ResetPasswordRequest,
  type VerifyEmailRequest,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { MailService } from '../mail/mail.service';
import { TenantDirectory } from '../platform/tenant-directory';
import { SessionService } from '../sessions/session.service';
import { AccountGateService } from '../security/account-gate.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { CaptchaService } from '../security/captcha.service';
import { PasswordService } from '../security/password.service';
import { RateLimitService } from '../security/rate-limit.service';
import { normalizeIp } from '../support/ip';
import { AuthKeys, Ttl } from '../support/redis-keys';
import { UserTokensService } from './user-tokens.service';

const MAIL_COOLDOWN_SECONDS = 60;
const FORGOT_PER_IP_PER_HOUR = 20;
const WORKSPACE_LOOKUP_PER_EMAIL_PER_HOUR = 5;

/**
 * Everything that is a link in an email: forgot/reset password, email
 * verification, "find my workspace", email change (TW-AUTH-013/014/015).
 *
 * Responses to the public endpoints are identical whether or not the account
 * exists, and the mail itself is sent after the response is decided so latency
 * is not an oracle either.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: TenantDirectory,
    private readonly tokens: UserTokensService,
    private readonly mail: MailService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly gates: AccountGateService,
    private readonly audit: AuthAuditService,
    private readonly captcha: CaptchaService,
    private readonly rate: RateLimitService,
  ) {}

  // --- forgot / reset ------------------------------------------------------------------------------

  async forgotPassword(req: ForgotPasswordRequest): Promise<void> {
    await this.captcha.assert(req.captchaToken, 'forgot');
    const ip = normalizeIp(RequestContextStore.peek()?.ip) ?? 'unknown';
    if (!(await this.rate.allow(AuthKeys.ipThrottle('forgot', ip), FORGOT_PER_IP_PER_HOUR, 3600))) {
      // Still neutral: the caller learns nothing, and no mail goes out.
      return;
    }
    // Work happens after returning, so "unknown org" is not faster than "sent".
    void this.processForgot(req).catch((err: unknown) => {
      this.logger.warn({ err }, 'forgot-password processing failed');
    });
  }

  private async processForgot(req: ForgotPasswordRequest): Promise<void> {
    const org = await this.tenants.findOrgBySlug(req.orgSlug);
    if (!org || org.status !== 'active') return;

    // One mail per address per minute (Reference's broker throttle).
    const first = await this.rate.hit(
      AuthKeys.mailThrottle('forgot', org.id, req.email),
      MAIL_COOLDOWN_SECONDS,
    );
    if (first.count > 1) return;

    const user = await this.db.txAs({ orgId: org.id }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, full_name FROM users WHERE org_id = ${org.id} AND email = ${req.email} AND status = 'active'
      `);
      return res.rows[0] as unknown as { id: number; full_name: string } | undefined;
    });
    if (!user) return;

    const token = await this.db.txAs({ orgId: org.id, userId: user.id }, async (tx) => {
      const t = await this.tokens.issue(
        tx,
        org.id,
        user.id,
        'password_reset',
        Ttl.resetPasswordSeconds,
      );
      await this.audit.record(tx, {
        event: 'auth.password_reset_requested',
        status: 'info',
        orgId: org.id,
        actorType: 'user',
        actorId: user.id,
        recordId: user.id,
      });
      return t;
    });
    await this.mail.sendPasswordReset(
      req.email,
      user.full_name,
      this.mail.link('/reset-password', { org: org.slug, token }),
    );
  }

  async resetPassword(req: ResetPasswordRequest): Promise<void> {
    const org = await this.tenants.findOrgBySlug(req.orgSlug);
    if (!org || org.status !== 'active') throw this.tokens.invalid();

    // Peek first: a password that fails the policy must not burn a good token.
    const peeked = await this.tokens.peek(org.id, 'password_reset', req.token);
    if (!peeked) throw this.tokens.invalid();

    const user = await this.db.txAs({ orgId: org.id }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, email, full_name, status FROM users WHERE org_id = ${org.id} AND id = ${peeked.userId}
      `);
      return res.rows[0] as unknown as
        { id: number; email: string; full_name: string; status: string } | undefined;
    });
    if (!user || user.status !== 'active') throw this.tokens.invalid();

    await this.passwords.assertAcceptable(req.password, {
      email: user.email,
      fullName: user.full_name,
    });
    const passwordHash = await this.passwords.hash(req.password);

    await this.db.txAs({ orgId: org.id, userId: user.id }, async (tx) => {
      const consumed = await this.tokens.consume(tx, org.id, 'password_reset', req.token);
      if (!consumed) throw this.tokens.invalid();

      await tx.execute(
        sql`UPDATE users SET password_hash = ${passwordHash} WHERE org_id = ${org.id} AND id = ${user.id}`,
      );
      // Proving control of the inbox also proves the address, so a reset
      // clears an outstanding verification and any forced change.
      await tx.execute(sql`
        INSERT INTO user_security (org_id, user_id, password_changed_at, force_password_change, email_verified_at)
        VALUES (${org.id}, ${user.id}, now(), false, now())
        ON CONFLICT (org_id, user_id) DO UPDATE
          SET password_changed_at = now(), force_password_change = false,
              email_verified_at = COALESCE(user_security.email_verified_at, now())
      `);
      await this.audit.record(tx, {
        event: 'auth.password_reset',
        status: 'success',
        orgId: org.id,
        actorType: 'user',
        actorId: user.id,
        recordId: user.id,
      });
    });

    // Every device signs out; the person re-authenticates with the new password.
    await this.sessions.revokeAllForUser(org.id, user.id, 'password_reset');
    await this.gates.invalidate(org.id, user.id);
    void this.mail.sendPasswordChanged(
      user.email,
      user.full_name,
      this.mail.link('/forgot-password', { org: org.slug }),
    );
  }

  // --- email verification ----------------------------------------------------------------------------------

  /** Verifies the address. Never signs anyone in. */
  async verifyEmail(req: VerifyEmailRequest): Promise<void> {
    const org = await this.tenants.findOrgBySlug(req.orgSlug);
    if (!org || org.status !== 'active') throw this.tokens.invalid();

    const userId = await this.db.txAs({ orgId: org.id }, async (tx) => {
      const consumed = await this.tokens.consume(tx, org.id, 'email_verify', req.token);
      if (!consumed) throw this.tokens.invalid();
      await tx.execute(sql`
        INSERT INTO user_security (org_id, user_id, email_verified_at)
        VALUES (${org.id}, ${consumed.userId}, now())
        ON CONFLICT (org_id, user_id) DO UPDATE
          SET email_verified_at = COALESCE(user_security.email_verified_at, now())
      `);
      await this.audit.record(tx, {
        event: 'auth.email_verified',
        status: 'success',
        orgId: org.id,
        actorType: 'user',
        actorId: consumed.userId,
        recordId: consumed.userId,
      });
      return consumed.userId;
    });
    await this.gates.invalidate(org.id, userId);
  }

  /** Authenticated resend, throttled (Reference's was not). */
  async resendVerification(): Promise<{ sent: boolean; alreadyVerified: boolean }> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    const userId = ctx.userId!;

    const row = await this.db.txAs({ orgId, userId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT u.email, u.full_name, o.slug, s.email_verified_at
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        LEFT JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
        WHERE u.org_id = ${orgId} AND u.id = ${userId}
      `);
      return res.rows[0] as unknown as
        | { email: string; full_name: string; slug: string; email_verified_at: Date | null }
        | undefined;
    });
    if (!row) throw AppError.unauthenticated();
    if (row.email_verified_at) return { sent: false, alreadyVerified: true };

    const hit = await this.rate.hit(
      AuthKeys.mailThrottle('verify', orgId, row.email),
      MAIL_COOLDOWN_SECONDS,
    );
    if (hit.count > 1) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        `Please wait ${hit.retryAfterSeconds} seconds before asking for another email.`,
        HttpStatus.TOO_MANY_REQUESTS,
        [{ path: 'retryAfterSeconds', message: String(hit.retryAfterSeconds) }],
      );
    }
    const token = await this.db.txAs({ orgId, userId }, (tx) =>
      this.tokens.issue(tx, orgId, userId, 'email_verify', Ttl.verifyEmailSeconds),
    );
    const sent = await this.mail.sendVerifyEmail(
      row.email,
      row.full_name,
      this.mail.link('/verify-email', { org: row.slug, token }),
    );
    return { sent, alreadyVerified: false };
  }

  // --- find my workspace ----------------------------------------------------------------------------------------

  async findWorkspaces(req: FindWorkspacesRequest): Promise<void> {
    await this.captcha.assert(req.captchaToken, 'forgot');
    const ip = normalizeIp(RequestContextStore.peek()?.ip) ?? 'unknown';
    if (!(await this.rate.allow(AuthKeys.ipThrottle('find-ws', ip), FORGOT_PER_IP_PER_HOUR, 3600)))
      return;

    void (async () => {
      const allowed = await this.rate.allow(
        `auth:find-ws:${req.email}`,
        WORKSPACE_LOOKUP_PER_EMAIL_PER_HOUR,
        3600,
      );
      if (!allowed) return;
      // Only verified addresses are listed, so nobody can harvest which
      // organizations an arbitrary email belongs to.
      const orgs = await this.tenants.orgsForVerifiedEmail(req.email);
      if (orgs.length === 0) return;
      await this.mail.sendWorkspaceList(
        req.email,
        orgs.map((o) => ({ name: o.name, url: this.mail.link('/login', { org: o.slug }) })),
      );
    })().catch((err: unknown) => this.logger.warn({ err }, 'find-workspaces failed'));
  }

  // --- email change -----------------------------------------------------------------------------------------------

  async requestEmailChange(req: ChangeEmailRequest): Promise<void> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    const userId = ctx.userId!;

    const row = await this.db.txAs({ orgId, userId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT u.email, u.full_name, u.password_hash, o.slug FROM users u
        JOIN organizations o ON o.id = u.org_id
        WHERE u.org_id = ${orgId} AND u.id = ${userId}
      `);
      return res.rows[0] as unknown as
        | { email: string; full_name: string; password_hash: string | null; slug: string }
        | undefined;
    });
    if (!row) throw AppError.unauthenticated();

    if (!(await this.passwords.verifyOrDummy(row.password_hash, req.password))) {
      throw new AppError(
        ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG,
        'The password you entered is not correct.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (req.newEmail === row.email) {
      throw AppError.validation('That is already your email address.', [
        { path: 'newEmail', message: 'Same as current.' },
      ]);
    }

    const token = await this.db.txAs({ orgId, userId }, async (tx) => {
      const taken = await tx.execute(
        sql`SELECT 1 FROM users WHERE org_id = ${orgId} AND email = ${req.newEmail}`,
      );
      if (taken.rows.length > 0) {
        throw new AppError(
          ERROR_CODES.AUTH_EMAIL_TAKEN,
          'That email is already used in this workspace.',
          HttpStatus.CONFLICT,
          [{ path: 'newEmail', message: 'Already in use.' }],
        );
      }
      const t = await this.tokens.issue(tx, orgId, userId, 'email_change', Ttl.emailChangeSeconds, {
        newEmail: req.newEmail,
      });
      await this.audit.record(tx, {
        event: 'auth.email_change_requested',
        status: 'info',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
      });
      return t;
    });
    await this.mail.sendEmailChange(
      req.newEmail,
      row.full_name,
      this.mail.link('/confirm-email-change', { org: row.slug, token }),
    );
  }

  async confirmEmailChange(orgSlug: string, token: string): Promise<void> {
    const org = await this.tenants.findOrgBySlug(orgSlug);
    if (!org || org.status !== 'active') throw this.tokens.invalid();

    const result = await this.db.txAs({ orgId: org.id }, async (tx) => {
      const consumed = await this.tokens.consume(tx, org.id, 'email_change', token);
      if (!consumed) throw this.tokens.invalid();
      const newEmail = String(consumed.payload.newEmail ?? '');
      const old = await tx.execute(
        sql`SELECT email, full_name FROM users WHERE org_id = ${org.id} AND id = ${consumed.userId}`,
      );
      const oldRow = old.rows[0] as unknown as { email: string; full_name: string } | undefined;
      if (!oldRow || !newEmail) throw this.tokens.invalid();
      try {
        await tx.execute(
          sql`UPDATE users SET email = ${newEmail} WHERE org_id = ${org.id} AND id = ${consumed.userId}`,
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(
            ERROR_CODES.AUTH_EMAIL_TAKEN,
            'That email is already used in this workspace.',
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      }
      // The new address just proved it is reachable.
      await tx.execute(sql`
        INSERT INTO user_security (org_id, user_id, email_verified_at) VALUES (${org.id}, ${consumed.userId}, now())
        ON CONFLICT (org_id, user_id) DO UPDATE SET email_verified_at = now()
      `);
      await this.audit.record(tx, {
        event: 'auth.email_changed',
        status: 'success',
        orgId: org.id,
        actorType: 'user',
        actorId: consumed.userId,
        recordId: consumed.userId,
        payload: { from: oldRow.email, to: newEmail },
      });
      return { userId: consumed.userId, oldEmail: oldRow.email, newEmail, name: oldRow.full_name };
    });
    await this.gates.invalidate(org.id, result.userId);
    void this.mail.sendEmailChangedNotice(
      result.oldEmail,
      result.name,
      result.newEmail,
      this.mail.link('/forgot-password', { org: org.slug }),
    );
  }
}
