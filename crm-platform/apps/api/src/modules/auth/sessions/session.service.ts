import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { ERROR_CODES, type SessionItem, type TokenPair } from '@crm/contracts';
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { toIsoString, toMs, type DateLike } from '../support/dates';
import { normalizeIp } from '../support/ip';
import { AuthKeys, Ttl } from '../support/redis-keys';
import { describeAgent } from '../support/user-agent';
import { TokenService } from '../token.service';
import { EpochService } from './epoch.service';

export interface CreateSessionInput {
  orgId: number;
  userId: number;
  userUuid: string;
  remember: boolean;
  mfaVerified: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

export interface SessionTokens {
  tokens: TokenPair;
  sessionId: string;
}

interface SessionRow {
  id: number;
  uuid: string;
  user_id: number;
  remember: boolean;
  mfa_verified: boolean;
  refresh_version: number;
  rotated_at: DateLike;
  last_used_at: DateLike;
  expires_at: DateLike;
  revoked_at: DateLike | null;
  ip: string | null;
  user_agent: string | null;
  created_at: DateLike;
}

type RotateDecision =
  | { kind: 'ok'; row: SessionRow; rv: number; userUuid: string; expiresAt: Date }
  | { kind: 'reject'; reason: string; audit?: 'reuse' | 'idle' };

/**
 * Server-side sessions with refresh-token rotation (ADR-0019).
 *
 * One `auth_sessions` row per login. The refresh token is a signed JWT that
 * carries a counter `rv`; no token material is stored. Rotating bumps the
 * counter. A token one step behind the counter, presented within the grace
 * window, is two browser tabs racing and is answered with the current token.
 * Anything older is a replayed token: the whole session is revoked.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: TokenService,
    private readonly policy: SecurityPolicyService,
    private readonly epoch: EpochService,
    private readonly audit: AuthAuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // --- create ----------------------------------------------------------------

  async create(input: CreateSessionInput): Promise<SessionTokens> {
    const policy = await this.policy.policy();
    const ep = await this.epoch.current();
    const refreshMax = this.tokens.refreshTtlSeconds();
    const lifetime = input.remember
      ? refreshMax
      : Math.min(Ttl.sessionNoRememberSeconds, refreshMax);
    const ip = normalizeIp(input.ip);

    const { sid, evicted } = await this.db.txAs(
      { orgId: input.orgId, userId: input.userId },
      async (tx) => {
        let evictedIds: string[] = [];
        // Concurrent-session cap (TW-AUTH-034): enforced here, at issuance,
        // instead of on every request like Reference's middleware. 0 = unlimited.
        if (policy.maxConcurrentSessions > 0) {
          const live = await tx.execute(sql`
            SELECT uuid FROM auth_sessions
            WHERE org_id = ${input.orgId} AND user_id = ${input.userId}
              AND revoked_at IS NULL AND expires_at > now()
            ORDER BY last_used_at ASC
          `);
          const over = live.rows.length - policy.maxConcurrentSessions + 1;
          if (over > 0) {
            const victims = (live.rows as unknown as Array<{ uuid: string }>)
              .slice(0, over)
              .map((r) => r.uuid);
            await tx.execute(sql`
              UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'session_cap'
              WHERE org_id = ${input.orgId}
                AND uuid IN (${sql.join(
                  victims.map((v) => sql`${v}::uuid`),
                  sql`, `,
                )})
            `);
            evictedIds = victims;
          }
        }

        const res = await tx.execute(sql`
          INSERT INTO auth_sessions (org_id, user_id, remember, mfa_verified, ip, user_agent, expires_at)
          VALUES (${input.orgId}, ${input.userId}, ${input.remember}, ${input.mfaVerified},
                  ${ip}::inet, ${input.userAgent?.slice(0, 512) ?? null},
                  now() + make_interval(secs => ${lifetime}))
          RETURNING uuid
        `);
        const row = res.rows[0] as unknown as { uuid: string };

        if (evictedIds.length > 0) {
          await this.audit.record(tx, {
            event: 'auth.concurrent_sessions_evicted',
            status: 'warning',
            actorType: 'user',
            actorId: input.userId,
            recordId: input.userId,
            payload: { cap: policy.maxConcurrentSessions, evicted: evictedIds.length },
          });
        }
        return { sid: row.uuid, evicted: evictedIds };
      },
    );

    await Promise.all(evicted.map((id) => this.tombstone(id)));
    await this.touchActivity(sid);

    const tokens = await this.tokens.issue(
      {
        sub: input.userId,
        org: input.orgId,
        typ: 'user',
        uid: input.userUuid,
        sid,
        ep,
        rv: 1,
        rm: input.remember,
      },
      { refreshTtlSeconds: lifetime },
    );
    return { tokens, sessionId: sid };
  }

  // --- refresh ---------------------------------------------------------------

  async refresh(refreshToken: string): Promise<SessionTokens> {
    const claims = await this.tokens.verifyRefresh(refreshToken);
    if (claims.typ !== 'user' || !claims.sid || claims.rv === undefined) {
      // Sessions pre-dating ADR-0019 (or another pool) cannot be rotated here.
      throw AppError.unauthenticated('Invalid or expired refresh token');
    }
    const ep = await this.epoch.current();
    if ((claims.ep ?? 0) < ep) throw AppError.unauthenticated('Invalid or expired refresh token');

    const policy = await this.policy.policy();
    const sid = claims.sid;
    const presented = claims.rv;
    const lastActivity = await this.readActivity(sid);

    const decision: RotateDecision = await this.db.txAs(
      { orgId: claims.org, userId: claims.sub },
      async (tx) => {
        const res = await tx.execute(sql`
          SELECT s.id, s.uuid, s.user_id, s.remember, s.mfa_verified, s.refresh_version, s.rotated_at,
                 s.last_used_at, s.expires_at, s.revoked_at, s.ip, s.user_agent, s.created_at,
                 u.status AS user_status, u.uuid AS user_uuid
          FROM auth_sessions s
          JOIN users u ON u.org_id = s.org_id AND u.id = s.user_id
          WHERE s.org_id = ${claims.org} AND s.uuid = ${sid}::uuid
          FOR UPDATE OF s
        `);
        const row = res.rows[0] as unknown as
          (SessionRow & { user_status: string; user_uuid: string }) | undefined;
        if (!row || row.revoked_at || toMs(row.expires_at) <= Date.now()) {
          return { kind: 'reject', reason: 'session_ended' } as const;
        }
        if (row.user_status !== 'active') {
          await tx.execute(sql`
            UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'user_inactive'
            WHERE org_id = ${claims.org} AND id = ${row.id}
          `);
          return { kind: 'reject', reason: 'user_inactive' } as const;
        }

        // Idle timeout (TW-AUTH-033): remembered sessions are exempt, as in Reference.
        const idleMs = policy.sessionTimeoutMinutes * 60_000;
        const active = Math.max(toMs(row.last_used_at), lastActivity ?? 0);
        if (!row.remember && idleMs > 0 && Date.now() - active > idleMs) {
          await tx.execute(sql`
            UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'idle'
            WHERE org_id = ${claims.org} AND id = ${row.id}
          `);
          await this.audit.record(tx, {
            event: 'auth.session_timeout',
            status: 'warning',
            orgId: claims.org,
            actorType: 'user',
            actorId: claims.sub,
            recordId: claims.sub,
            payload: {
              idleSeconds: Math.round((Date.now() - active) / 1000),
              limitMinutes: policy.sessionTimeoutMinutes,
            },
          });
          return { kind: 'reject', reason: 'idle', audit: 'idle' } as const;
        }

        const current = row.refresh_version;
        const rotatedAgo = Date.now() - toMs(row.rotated_at);

        if (presented === current) {
          // Remembered sessions slide; others keep their absolute deadline.
          const refreshMax = this.tokens.refreshTtlSeconds();
          await tx.execute(sql`
            UPDATE auth_sessions
            SET refresh_version = refresh_version + 1, rotated_at = now(), last_used_at = now(),
                expires_at = CASE WHEN remember THEN now() + make_interval(secs => ${refreshMax}) ELSE expires_at END
            WHERE org_id = ${claims.org} AND id = ${row.id}
          `);
          const expiresAt = row.remember
            ? new Date(Date.now() + refreshMax * 1000)
            : new Date(toMs(row.expires_at));
          return { kind: 'ok', row, rv: current + 1, userUuid: row.user_uuid, expiresAt } as const;
        }

        if (presented === current - 1 && rotatedAgo <= Ttl.refreshGraceSeconds * 1000) {
          await tx.execute(sql`
            UPDATE auth_sessions SET last_used_at = now() WHERE org_id = ${claims.org} AND id = ${row.id}
          `);
          return {
            kind: 'ok',
            row,
            rv: current,
            userUuid: row.user_uuid,
            expiresAt: new Date(toMs(row.expires_at)),
          } as const;
        }

        // A token from before the previous rotation: it was stolen or replayed.
        await tx.execute(sql`
          UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'refresh_reuse'
          WHERE org_id = ${claims.org} AND id = ${row.id}
        `);
        return { kind: 'reject', reason: 'refresh_reuse', audit: 'reuse' } as const;
      },
    );

    if (decision.kind === 'reject') {
      await this.tombstone(sid);
      if (decision.audit === 'reuse') {
        await this.audit.recordStandalone({
          event: 'auth.refresh_reuse_detected',
          status: 'failure',
          orgId: claims.org,
          actorType: 'user',
          actorId: claims.sub,
          recordId: claims.sub,
          payload: { sessionId: sid },
        });
      }
      throw AppError.unauthenticated('Invalid or expired refresh token');
    }

    await this.touchActivity(sid);
    const remainingSeconds = Math.max(
      60,
      Math.floor((decision.expiresAt.getTime() - Date.now()) / 1000),
    );
    const tokens = await this.tokens.issue(
      {
        sub: claims.sub,
        org: claims.org,
        typ: 'user',
        uid: decision.userUuid,
        sid,
        ep,
        rv: decision.rv,
        rm: decision.row.remember,
      },
      { refreshTtlSeconds: remainingSeconds },
    );
    return { tokens, sessionId: sid };
  }

  // --- revoke ----------------------------------------------------------------

  /** Ends one session. Returns whether a live session was actually revoked. */
  async revoke(orgId: number, sessionUuid: string, reason: string): Promise<boolean> {
    const res = await this.db.txAs({ orgId }, async (tx) =>
      tx.execute(sql`
        UPDATE auth_sessions SET revoked_at = now(), revoked_reason = ${reason}
        WHERE org_id = ${orgId} AND uuid = ${sessionUuid}::uuid AND revoked_at IS NULL
        RETURNING 1
      `),
    );
    await this.tombstone(sessionUuid);
    return res.rows.length > 0;
  }

  /** Every live session of a user except `exceptSid`. Returns how many ended. */
  async revokeAllForUser(
    orgId: number,
    userId: number,
    reason: string,
    exceptSid?: string,
  ): Promise<number> {
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        UPDATE auth_sessions SET revoked_at = now(), revoked_reason = ${reason}
        WHERE org_id = ${orgId} AND user_id = ${userId} AND revoked_at IS NULL
          AND (${exceptSid ?? null}::uuid IS NULL OR uuid <> ${exceptSid ?? null}::uuid)
        RETURNING uuid
      `),
    );
    const ids = (res.rows as unknown as Array<{ uuid: string }>).map((r) => r.uuid);
    await Promise.all(ids.map((id) => this.tombstone(id)));
    return ids.length;
  }

  // --- list ------------------------------------------------------------------

  async list(
    orgId: number,
    userId: number,
    currentSid: string | undefined,
  ): Promise<SessionItem[]> {
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        SELECT uuid, remember, host(ip) AS ip, user_agent, created_at, last_used_at
        FROM auth_sessions
        WHERE org_id = ${orgId} AND user_id = ${userId}
          AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_used_at DESC
        LIMIT 100
      `),
    );
    const rows = res.rows as unknown as Array<{
      uuid: string;
      remember: boolean;
      ip: string | null;
      user_agent: string | null;
      created_at: DateLike;
      last_used_at: DateLike;
    }>;
    const activity = await Promise.all(rows.map((r) => this.readActivity(r.uuid)));

    return rows
      .map((r, i) => {
        const agent = describeAgent(r.user_agent);
        const last = Math.max(toMs(r.last_used_at), activity[i] ?? 0);
        return {
          id: r.uuid,
          current: r.uuid === currentSid,
          device: agent.label,
          deviceKind: agent.kind,
          ip: r.ip,
          createdAt: toIsoString(r.created_at),
          lastUsedAt: new Date(last).toISOString(),
          remember: r.remember,
        };
      })
      .sort(
        (a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt.localeCompare(a.lastUsedAt),
      );
  }

  async belongsToUser(orgId: number, userId: number, sessionUuid: string): Promise<boolean> {
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        SELECT 1 FROM auth_sessions
        WHERE org_id = ${orgId} AND user_id = ${userId} AND uuid = ${sessionUuid}::uuid
          AND revoked_at IS NULL
      `),
    );
    return res.rows.length > 0;
  }

  // --- redis helpers ---------------------------------------------------------

  async tombstone(sid: string): Promise<void> {
    await this.redis
      .set(AuthKeys.revoked(sid), '1', 'EX', Ttl.accessRevocationSeconds)
      .catch((err: unknown) => {
        this.logger.error({ err, sid }, 'failed to write session tombstone');
      });
  }

  async touchActivity(sid: string): Promise<void> {
    await this.redis
      .set(AuthKeys.activity(sid), String(Date.now()), 'EX', 7 * 24 * 3600)
      .catch(() => undefined);
  }

  private async readActivity(sid: string): Promise<number | null> {
    const raw = await this.redis.get(AuthKeys.activity(sid)).catch(() => null);
    return raw ? Number(raw) : null;
  }

  assertOwnSessionTarget(current: string | undefined, target: string): void {
    if (current && current === target) {
      throw new AppError(
        ERROR_CODES.AUTH_CANNOT_REVOKE_CURRENT,
        'Use sign out to end the current session.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }
}
