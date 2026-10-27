import { Injectable, Logger } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import type { LoginResponse, TokenPair } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { AppError } from '../../common/errors/app-error';
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
 * refresh) and the refresh dispatcher.
 *
 * Staff login, MFA, sign-up and recovery live in `flows/`.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: TokenService,
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
