import { Injectable, Logger } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import type { LoginResponse, TokenPair } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { ClerkService } from './clerk.service';
import { LoginService, type ClientMeta } from './flows/login.service';
import { SecurityPolicyService } from './platform/security-policy.service';
import { AccountAttackGuard } from './security/account-attack.service';
import { TenantDirectory } from './platform/tenant-directory';
import { EpochService } from './sessions/epoch.service';
import { PartnerAgentStatusService } from './sessions/partner-agent-status.service';
import { SessionService } from './sessions/session.service';
import { normalizeIp } from './support/ip';
import { AuthKeys } from './support/redis-keys';
import { TokenService } from './token.service';

interface LoginRow {
  id: number;
  uuid: string;
  password_hash: string | null;
  status: string;
}

/**
 * The pools that are not staff password login: partner agents (stateless
 * refresh), the Clerk exchange, and the refresh dispatcher.
 *
 * Staff login, MFA, sign-up and recovery live in `flows/`.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: TokenService,
    private readonly clerk: ClerkService,
    private readonly tenants: TenantDirectory,
    private readonly sessions: SessionService,
    private readonly login: LoginService,
    private readonly policy: SecurityPolicyService,
    private readonly epoch: EpochService,
    private readonly partnerStatus: PartnerAgentStatusService,
    private readonly attack: AccountAttackGuard,
  ) {}

  /**
   * Partner-portal sign-in. It shares the staff lockout rules (TW-AUTH-002): the
   * same failure limit and window, counted per organization, address and IP, in
   * a counter of its own so a partner's typos cannot lock a staff member out.
   * Partner agents have no second factor to challenge.
   */
  async loginPartnerAgent(
    orgSlug: string,
    email: string,
    password: string,
    meta: ClientMeta = {},
  ): Promise<TokenPair> {
    const orgId = await this.resolveOrgId(orgSlug);
    const policy = await this.policy.policy();
    const lockKey = AuthKeys.partnerLockout(orgId, email, normalizeIp(meta.ip) ?? 'unknown');
    await this.login.assertNotLocked(lockKey, policy, { orgId, email });
    await this.attack.assertAllowed(
      'partner',
      orgId,
      email,
      normalizeIp(meta.ip),
      undefined,
      policy,
    );

    const row = await this.db.txAs({ orgId }, async (tx) => {
      const result = await tx.execute(sql`
        SELECT id, uuid, password_hash, status::text AS status
        FROM partner_agents
        WHERE org_id = ${orgId} AND email = ${email}
      `);
      return result.rows[0] as unknown as LoginRow | undefined;
    });

    try {
      await this.assertPassword(row, password, 'active');
    } catch (err) {
      await this.login.recordFailedSignIn(lockKey, policy);
      await this.attack.recordFailure('partner', orgId, email, policy);
      throw err;
    }
    await this.login.clearLockout(lockKey);
    void this.attack.rememberNetwork('partner', orgId, email, normalizeIp(meta.ip));

    await this.db.txAs({ orgId }, async (tx) => {
      await tx.execute(
        sql`UPDATE partner_agents SET last_login_at = now() WHERE org_id = ${orgId} AND id = ${row!.id}`,
      );
    });

    this.logger.log({ orgId, agentId: row!.id }, 'partner agent login');
    // `ep` ties the pair to the platform epoch, so "revoke all sessions" reaches partner agents too.
    return this.tokens.issue({
      sub: row!.id,
      org: orgId,
      typ: 'partner_agent',
      uid: row!.uuid,
      ep: await this.epoch.current(),
    });
  }

  /**
   * Staff login through a Clerk session token. Clerk verified the credential;
   * this links it to an EXISTING local user, by `auth_subject` and then by
   * email, and opens a normal session.
   *
   * It no longer creates users. The old version auto-provisioned a user for
   * any valid Clerk identity in any organization the caller named, which let
   * anyone with a Clerk account join any tenant (known issue). A
   * person with no row is now told to ask for an invitation.
   */
  clerkConfigured(): boolean {
    return this.clerk.isConfigured();
  }

  async loginViaClerk(
    orgSlug: string,
    clerkToken: string,
    meta: ClientMeta,
  ): Promise<LoginResponse> {
    const identity = await this.clerk.verifySession(clerkToken);
    const org = await this.tenants.findOrgBySlug(orgSlug);
    if (!org || org.status !== 'active') throw AppError.unauthenticated('Invalid credentials');

    // The same lockout as a password sign-in, on the same counter (org + email + IP): a
    // locked-out person is refused whichever door they use, and an identity that has no
    // local account counts as a failed attempt (TW-AUTH-002).
    const policy = await this.policy.policy();
    const lockKey = AuthKeys.lockout(org.id, identity.email, normalizeIp(meta.ip) ?? 'unknown');
    await this.login.assertNotLocked(lockKey, policy, { orgId: org.id, email: identity.email });

    const row = await this.db.txAs({ orgId: org.id }, async (tx) => {
      const bySubject = await tx.execute(sql`
        SELECT id, uuid, email, full_name, status FROM users
        WHERE org_id = ${org.id} AND auth_subject = ${identity.clerkUserId}
      `);
      if (bySubject.rows[0]) return bySubject.rows[0];
      const linked = await tx.execute(sql`
        UPDATE users SET auth_subject = ${identity.clerkUserId}
        WHERE org_id = ${org.id} AND email = ${identity.email} AND auth_subject IS NULL
        RETURNING id, uuid, email, full_name, status
      `);
      return linked.rows[0];
    });
    const user = row as unknown as
      { id: number; uuid: string; email: string; full_name: string; status: string } | undefined;
    // A suspended person gets in and is held at the suspended screen, as with a password (TW-AUTH-016).
    if (!user) {
      await this.login.recordFailedSignIn(lockKey, policy);
      throw AppError.unauthenticated('Invalid credentials');
    }

    this.logger.log({ orgId: org.id, userId: user.id }, 'clerk login');
    await this.login.clearLockout(lockKey);

    // Clerk vouched for the first factor only. A person who turned on two-factor here is
    // challenged exactly as after a password (TW-AUTH-030/032); the exchange is not a back door.
    const loaded = await this.login.loadOrgAndUser(org.id, user.id);
    if (loaded?.user.mfa_enabled) {
      return this.login.issueMfaChallenge({
        orgId: org.id,
        userId: user.id,
        remember: false,
        method: 'social',
      });
    }
    return this.login.completeLogin({
      org,
      user: { id: user.id, uuid: user.uuid, email: user.email, fullName: user.full_name },
      remember: false,
      mfaVerified: false,
      method: 'social',
      meta,
    });
  }

  /**
   * Staff tokens rotate through server-side sessions; partner agents keep the
   * stateless re-issue.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const claims = await this.tokens.verifyRefresh(refreshToken);
    if (claims.typ === 'user') {
      return (await this.sessions.refresh(refreshToken)).tokens;
    }
    if (claims.typ === 'platform_operator') {
      throw AppError.unauthenticated('Invalid or expired refresh token');
    }
    if (claims.typ === 'partner_agent') {
      // No session row backs this pair, so renewal is where a suspended agent (or a bumped epoch) is stopped.
      const ep = await this.epoch.current();
      if ((claims.ep ?? 0) < ep) throw AppError.unauthenticated('Invalid or expired refresh token');
      await this.partnerStatus.assertActive(
        claims.org,
        claims.sub,
        'Invalid or expired refresh token',
      );
      return this.tokens.issue({
        sub: claims.sub,
        org: claims.org,
        typ: 'partner_agent',
        uid: claims.uid,
        ep,
      });
    }
    return this.tokens.issue({
      sub: claims.sub,
      org: claims.org,
      typ: claims.typ,
      uid: claims.uid,
    });
  }

  private async resolveOrgId(slug: string): Promise<number> {
    const org = await this.tenants.findOrgBySlug(slug);
    if (!org || org.status !== 'active') {
      // Same error as a bad password: distinguishing them would turn this into
      // an org-slug enumeration endpoint.
      throw AppError.unauthenticated('Invalid credentials');
    }
    return org.id;
  }

  private async assertPassword(
    row: LoginRow | undefined,
    password: string,
    activeStatus = 'active',
  ): Promise<void> {
    // Verify against a dummy hash even when the row is missing, so a
    // non-existent account takes the same time as a wrong password.
    const hashToCheck = row?.password_hash ?? DUMMY_HASH;
    const ok = await verify(hashToCheck, password).catch(() => false);

    if (!row || !ok || row.status !== activeStatus) {
      throw AppError.unauthenticated('Invalid credentials');
    }
  }
}

/** argon2id hash of a random string nobody knows. Used only for timing parity. */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$8cJ0Yc0CkB2S1sC7g3aKhQXbXmCLvxg4XmYXNnEXHbA';
