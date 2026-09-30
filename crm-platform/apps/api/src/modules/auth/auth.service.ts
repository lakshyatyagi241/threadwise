import { Injectable, Logger } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { ClerkService } from './clerk.service';
import { TokenService, type TokenPair } from './token.service';

interface LoginRow {
  id: number;
  uuid: string;
  password_hash: string | null;
  status: string;
}

/**
 * Login for the two human pools that exist today: staff users and partner
 * agents. Candidates join with the Exams module and follow the same shape.
 *
 * Both paths take the org slug because a bare email is not unique across
 * tenants — the same person can be staff at two orgs, and silently picking one
 * of them is worse than asking.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: TokenService,
    private readonly clerk: ClerkService,
  ) {}

  async loginStaff(orgSlug: string, email: string, password: string): Promise<TokenPair> {
    const orgId = await this.resolveOrgId(orgSlug);

    const row = await this.db.txAs({ orgId }, async (tx) => {
      const result = await tx.execute(sql`
        SELECT id, uuid, password_hash, status
        FROM users
        WHERE org_id = ${orgId} AND email = ${email}
      `);
      return result.rows[0] as unknown as LoginRow | undefined;
    });

    await this.assertPassword(row, password);

    this.logger.log({ orgId, userId: row!.id }, 'staff login');
    return this.tokens.issue({ sub: row!.id, org: orgId, typ: 'user', uid: row!.uuid });
  }

  async loginPartnerAgent(orgSlug: string, email: string, password: string): Promise<TokenPair> {
    const orgId = await this.resolveOrgId(orgSlug);

    const row = await this.db.txAs({ orgId }, async (tx) => {
      const result = await tx.execute(sql`
        SELECT id, uuid, password_hash, status::text AS status
        FROM partner_agents
        WHERE org_id = ${orgId} AND email = ${email}
      `);
      return result.rows[0] as unknown as LoginRow | undefined;
    });

    await this.assertPassword(row, password, 'active');

    await this.db.txAs({ orgId }, async (tx) => {
      await tx.execute(
        sql`UPDATE partner_agents SET last_login_at = now() WHERE org_id = ${orgId} AND id = ${row!.id}`,
      );
    });

    this.logger.log({ orgId, agentId: row!.id }, 'partner agent login');
    return this.tokens.issue({ sub: row!.id, org: orgId, typ: 'partner_agent', uid: row!.uuid });
  }

  /**
   * Staff login via Clerk. Clerk already verified the password/Google
   * credential — `clerkToken` is the session token from that, not a
   * password. This resolves it to a local `users` row (linking by
   * auth_subject, falling back to email, auto-provisioning if neither
   * matches) and issues our own token pair exactly like loginStaff.
   */
  async loginViaClerk(orgSlug: string, clerkToken: string): Promise<TokenPair> {
    const identity = await this.clerk.verifySession(clerkToken);
    const orgId = await this.resolveOrgId(orgSlug);

    const row = await this.db.txAs({ orgId }, async (tx) => {
      const byAuthSubject = await tx.execute(sql`
        SELECT id, uuid FROM users
        WHERE org_id = ${orgId} AND auth_subject = ${identity.clerkUserId}
      `);
      if (byAuthSubject.rows[0]) return byAuthSubject.rows[0] as { id: number; uuid: string };

      // Pre-existing row (created by an admin, or from before Clerk) that
      // matches on email — link it to this Clerk identity rather than
      // forking a second account for the same person.
      const byEmail = await tx.execute(sql`
        UPDATE users SET auth_subject = ${identity.clerkUserId}
        WHERE org_id = ${orgId} AND email = ${identity.email} AND auth_subject IS NULL
        RETURNING id, uuid
      `);
      if (byEmail.rows[0]) return byEmail.rows[0] as { id: number; uuid: string };

      const created = await tx.execute(sql`
        INSERT INTO users (org_id, email, full_name, auth_subject)
        VALUES (${orgId}, ${identity.email}, ${identity.fullName}, ${identity.clerkUserId})
        ON CONFLICT (org_id, email) DO UPDATE SET auth_subject = EXCLUDED.auth_subject
        RETURNING id, uuid
      `);
      return created.rows[0] as { id: number; uuid: string };
    });

    if (!row) {
      // Should be unreachable — insert always returns a row — but a thrown
      // AppError beats a null-deref three lines down.
      throw AppError.unauthenticated('Could not resolve Clerk identity to a user');
    }

    this.logger.log({ orgId, userId: row.id, clerkUserId: identity.clerkUserId }, 'clerk login');
    return this.tokens.issue({ sub: row.id, org: orgId, typ: 'user', uid: row.uuid });
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const claims = await this.tokens.verifyRefresh(refreshToken);
    return this.tokens.issue({
      sub: claims.sub,
      org: claims.org,
      typ: claims.typ,
      uid: claims.uid,
    });
  }

  /**
   * The org lookup runs privileged — by definition there is no tenant context
   * yet, since establishing it is the whole point of logging in.
   */
  private async resolveOrgId(slug: string): Promise<number> {
    const result = await this.db.privileged(async (tx) =>
      tx.execute(sql`SELECT id FROM organizations WHERE slug = ${slug} AND status = 'active'`),
    );
    const org = result.rows[0] as { id: number } | undefined;
    if (!org) {
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
    // non-existent account takes the same time as a wrong password. Without
    // this, response timing tells an attacker which emails are real.
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
