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

/** One page of a person's devices, in the shape of the standard list envelope plus a total. */
export interface SessionPage {
  data: SessionItem[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
  /** Every live session of the person, not just this page. */
  total: number;
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

/**
 * The 401 an idle session gets. It carries the limit so the sign-in page can
 * say "timed out after N minutes of inactivity" instead of a bare "expired"
 * (WD-AUTH-033): `errors` holds `reason: idle` and `idleMinutes: N`.
 */
export function idleTimeoutError(limitMinutes: number): AppError {
  return new AppError(
    ERROR_CODES.UNAUTHENTICATED,
    `Your session timed out after ${limitMinutes} minutes of inactivity.`,
    HttpStatus.UNAUTHORIZED,
    [
      { path: 'reason', message: 'idle' },
      { path: 'idleMinutes', message: String(limitMinutes) },
    ],
  );
}

type RotateDecision =
  | { kind: 'ok'; row: SessionRow; rv: number; userUuid: string; expiresAt: Date }
  | { kind: 'reject'; reason: string; audit?: 'reuse' | 'idle' };

/**
 * Server-side sessions with refresh-token rotation.
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
        // Two sign-ins at the same moment must not both count the same live
        // sessions and both stay under the cap: one person's issuance is serial.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-sessions:${input.orgId}:${input.userId}`}, 0))`,
        );
        // Concurrent-session cap (WD-AUTH-034): enforced here at issuance, and
        // again from the request guard when the cap is lowered later
        // (`enforceCapIfChanged`). 0 = unlimited.
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
    await this.markCapChecked(sid, policy.maxConcurrentSessions);

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
      // Sessions from before server-side sessions (or another pool) cannot be rotated here.
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
                 s.last_used_at, s.expires_at, s.revoked_at, s.revoked_reason, s.ip, s.user_agent, s.created_at,
                 u.uuid AS user_uuid
          FROM auth_sessions s
          JOIN users u ON u.org_id = s.org_id AND u.id = s.user_id
          WHERE s.org_id = ${claims.org} AND s.uuid = ${sid}::uuid
          FOR UPDATE OF s
        `);
        const row = res.rows[0] as unknown as
          (SessionRow & { user_uuid: string; revoked_reason: string | null }) | undefined;
        if (!row || row.revoked_at || toMs(row.expires_at) <= Date.now()) {
          // Ended by the idle rule already (the request guard does that): say so.
          if (row?.revoked_reason === 'idle') return { kind: 'reject', reason: 'idle' } as const;
          return { kind: 'reject', reason: 'session_ended' } as const;
        }
        // A suspended person keeps a session, held at the suspended screen by
        // the account gate (WD-AUTH-016); ending it here would turn "your
        // account is suspended" into "please sign in" after fifteen minutes.

        // Idle timeout (WD-AUTH-033): remembered sessions are exempt, as in WaDesk.
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
      if (decision.reason === 'idle') throw idleTimeoutError(policy.sessionTimeoutMinutes);
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

  /** Every live session of the person, current first. Not capped: nothing is silently left out. */
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
        ORDER BY last_used_at DESC, uuid DESC
      `),
    );
    return this.toItems(res.rows as unknown as SessionRowLite[], currentSid);
  }

  /**
   * One page of the devices list (WD-AUTH-031): the current device leads the
   * first page, the rest follow by recency, keyset-paged so no page is skipped
   * or repeated while sessions come and go. `total` counts every live session.
   *
   * Paging is by the stored last-used time; the time shown also folds in the
   * live activity stamp, so across a page boundary two devices used within the
   * same refresh interval can appear in either order.
   */
  async listPage(
    orgId: number,
    userId: number,
    currentSid: string | undefined,
    opts: { limit: number; cursor?: string },
  ): Promise<SessionPage> {
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const after = opts.cursor ? decodeSessionCursor(opts.cursor) : null;
    if (opts.cursor && !after) {
      throw AppError.validation('That page marker is not valid.', [
        { path: 'cursor', message: 'Invalid cursor.' },
      ]);
    }

    const { rows, total } = await this.db.txAs({ orgId, userId }, async (tx) => {
      const live = sql`org_id = ${orgId} AND user_id = ${userId} AND revoked_at IS NULL AND expires_at > now()`;
      const countRes = await tx.execute(
        sql`SELECT count(*)::int AS n FROM auth_sessions WHERE ${live}`,
      );
      const total = (countRes.rows[0] as unknown as { n: number }).n;

      const lead: SessionRowLite[] = [];
      if (!after && currentSid) {
        const cur = await tx.execute(sql`
          SELECT uuid, remember, host(ip) AS ip, user_agent, created_at, last_used_at,
                 ${PRECISE_TS} AS cursor_ts
          FROM auth_sessions WHERE ${live} AND uuid = ${currentSid}::uuid
        `);
        lead.push(...(cur.rows as unknown as SessionRowLite[]));
      }
      // The current device takes one place on the first page, so a page is `limit` rows.
      const room = limit - lead.length;
      const afterClause = after
        ? sql`AND (last_used_at, uuid) < (${after.t}::timestamptz, ${after.u}::uuid)`
        : sql``;
      const notCurrent = currentSid ? sql`AND uuid <> ${currentSid}::uuid` : sql``;
      const rest = await tx.execute(sql`
        SELECT uuid, remember, host(ip) AS ip, user_agent, created_at, last_used_at,
               ${PRECISE_TS} AS cursor_ts
        FROM auth_sessions
        WHERE ${live} ${notCurrent} ${afterClause}
        ORDER BY last_used_at DESC, uuid DESC
        LIMIT ${room + 1}
      `);
      return { rows: { lead, rest: rest.rows as unknown as SessionRowLite[], room }, total };
    });

    const hasMore = rows.rest.length > rows.room;
    const pageRest = rows.rest.slice(0, rows.room);
    const last = pageRest[pageRest.length - 1];
    const items = await this.toItems([...rows.lead, ...pageRest], currentSid);
    return {
      data: items,
      page: {
        // When the current device alone fills the page there is no last row to resume after:
        // the sentinel means "from the start of the other devices".
        nextCursor: !hasMore
          ? null
          : last
            ? encodeSessionCursor(last.cursor_ts!, last.uuid)
            : encodeSessionCursor('infinity', 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
        hasMore,
        limit,
      },
      total,
    };
  }

  private async toItems(
    rows: SessionRowLite[],
    currentSid: string | undefined,
  ): Promise<SessionItem[]> {
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

  /**
   * Ends a session the idle rule caught on a request (WD-AUTH-033): the row is
   * revoked and `auth.session_timeout` is written, once. The tombstone's NX
   * write is the "once": whoever sets it first does the database work.
   */
  async expireIdle(
    orgId: number,
    userId: number,
    sid: string,
    limitMinutes: number,
    lastActivityMs: number,
  ): Promise<void> {
    try {
      const first = await this.redis.set(
        AuthKeys.revoked(sid),
        '1',
        'EX',
        Ttl.accessRevocationSeconds,
        'NX',
      );
      if (first !== 'OK') return;
      await this.db.txAs({ orgId, userId }, async (tx) => {
        const res = await tx.execute(sql`
          UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'idle'
          WHERE org_id = ${orgId} AND uuid = ${sid}::uuid AND revoked_at IS NULL
          RETURNING 1
        `);
        if (res.rows.length === 0) return;
        await this.audit.record(tx, {
          event: 'auth.session_timeout',
          status: 'warning',
          orgId,
          actorType: 'user',
          actorId: userId,
          recordId: userId,
          payload: {
            idleSeconds: Math.round((Date.now() - lastActivityMs) / 1000),
            limitMinutes,
          },
        });
      });
    } catch (err) {
      this.logger.warn({ err, sid }, 'could not record idle session end');
    }
  }

  // --- cap changes (WD-AUTH-034) ----------------------------------------------

  /**
   * Lowering "max concurrent sessions" must reach the sessions that already
   * exist. Each session remembers the cap it was last checked against (Redis,
   * the same idea as WaDesk's per-session marker); when the policy's cap is
   * different, the next authenticated request from ANY of the person's
   * sessions trims the live set to the newest `cap`, keeping the one making
   * the request. Costs one extra key in the guard's existing MGET, and a
   * database round trip only on the first request after the cap changed.
   *
   * Never throws: a failing sweep must not fail the request that triggered it.
   */
  async enforceCapIfChanged(
    orgId: number,
    userId: number,
    sid: string,
    cap: number,
    marker: string | null,
  ): Promise<void> {
    if (marker === String(cap)) return;
    try {
      if (cap > 0) {
        const victims = await this.db.txAs({ orgId, userId }, async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`auth-sessions:${orgId}:${userId}`}, 0))`,
          );
          const live = await tx.execute(sql`
            SELECT uuid FROM auth_sessions
            WHERE org_id = ${orgId} AND user_id = ${userId}
              AND revoked_at IS NULL AND expires_at > now()
            ORDER BY (uuid = ${sid}::uuid) DESC, last_used_at DESC, uuid DESC
          `);
          const doomed = (live.rows as unknown as Array<{ uuid: string }>)
            .slice(cap)
            .map((r) => r.uuid);
          if (doomed.length === 0) return doomed;
          await tx.execute(sql`
            UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'session_cap'
            WHERE org_id = ${orgId}
              AND uuid IN (${sql.join(
                doomed.map((v) => sql`${v}::uuid`),
                sql`, `,
              )})
          `);
          await this.audit.record(tx, {
            event: 'auth.concurrent_sessions_evicted',
            status: 'warning',
            orgId,
            actorType: 'user',
            actorId: userId,
            recordId: userId,
            payload: { cap, evicted: doomed.length, trigger: 'cap_lowered' },
          });
          return doomed;
        });
        await Promise.all(victims.map((id) => this.tombstone(id)));
      }
      await this.markCapChecked(sid, cap);
    } catch (err) {
      this.logger.warn({ err, orgId, userId }, 'session cap sweep failed');
    }
  }

  async markCapChecked(sid: string, cap: number): Promise<void> {
    await this.redis
      .set(AuthKeys.capChecked(sid), String(cap), 'EX', 31 * 24 * 3600)
      .catch(() => undefined);
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

interface SessionRowLite {
  uuid: string;
  remember: boolean;
  ip: string | null;
  user_agent: string | null;
  created_at: DateLike;
  last_used_at: DateLike;
  /** `last_used_at` at full microsecond precision, for the page cursor. */
  cursor_ts?: string;
}

/** Microsecond-exact UTC timestamp text: a JS Date would round the cursor and skip or repeat rows. */
const PRECISE_TS = sql`to_char(last_used_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function encodeSessionCursor(t: string, u: string): string {
  return Buffer.from(JSON.stringify({ t, u }), 'utf8').toString('base64url');
}

function decodeSessionCursor(raw: string): { t: string; u: string } | null {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      t?: unknown;
      u?: unknown;
    };
    if (
      typeof v.t === 'string' &&
      typeof v.u === 'string' &&
      (v.t === 'infinity' || /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v.t)) &&
      /^[0-9a-f-]{36}$/i.test(v.u)
    ) {
      return { t: v.t, u: v.u };
    }
  } catch {
    // fall through
  }
  return null;
}
