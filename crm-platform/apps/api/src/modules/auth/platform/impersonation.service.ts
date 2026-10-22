import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  ERROR_CODES,
  IMPERSONATION_HANDOFF_SECONDS,
  IMPERSONATION_MAX_MINUTES,
  type ImpersonationStatus,
  type RedeemImpersonationResponse,
  type StartImpersonationRequest,
  type StartImpersonationResponse,
  type StopImpersonationResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  RequestContextStore,
  type ImpersonationContext,
} from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import type { Env } from '../../../config/env.schema';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { AuthAuditService } from '../security/auth-audit.service';
import { EpochService } from '../sessions/epoch.service';
import { randomToken, sha256Hex } from '../support/crypto-utils';
import { normalizeIp } from '../support/ip';
import { AuthKeys } from '../support/redis-keys';
import { TokenService, type TokenClaims } from '../token.service';
import { PlatformStore } from './platform-store';
import { CappedMap } from '../../../common/cache/capped-map';
import { cacheMetrics } from '@crm/observability';

const tombstone = cacheMetrics('impersonation_tombstone');
const openRow = cacheMetrics('impersonation_open');

export type ImpersonationEndedBy = 'operator' | 'expiry' | 'new_session' | 'access_revoked';

/** Where the operator lands after stopping: the console's workspace list (same web app, other cookie pool). */
export const IMPERSONATION_RETURN_PATH = '/admin/workspaces';

/** How long a "the session is still open" answer is trusted before the row is read again. Stop is instant anyway (tombstone). */
export const OPEN_CACHE_MS = 5_000;

interface SessionRow {
  id: number;
  uuid: string;
  operator_id: number;
  org_id: number;
  user_id: number;
  reason: string;
  read_only: boolean;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  operator_uuid: string;
  operator_name: string;
  operator_role: string;
  operator_status: string;
}

interface CachedOpen {
  checkedAt: number;
  row: SessionRow;
}

/**
 * Operator impersonation as an act-as token (TW-WSP-032/033, ADR-0019).
 *
 * The operator never receives the owner's password or a copy of the owner's session. Starting writes a row of
 * `impersonation_sessions` and returns a one-time handoff code (60 s, single use, only its hash stored). The workspace app
 * redeems it server-to-server for an ACCESS-ONLY token whose `imp` claim names the session; nothing can refresh it, it ends
 * with the session, and every request re-checks that the row is still open. The operator's own session is never touched.
 *
 * The table is platform-only (privileged policy), so every read and write goes through PlatformStore.
 */
@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);
  private readonly open = new CappedMap<string, CachedOpen>(1000);

  constructor(
    private readonly store: PlatformStore,
    private readonly tokens: TokenService,
    private readonly audit: AuthAuditService,
    private readonly epoch: EpochService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // --- start (operator side) ----------------------------------------------------------------------------------------------

  async start(
    orgUuid: string,
    input: StartImpersonationRequest,
  ): Promise<StartImpersonationResponse> {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'platform_operator' || !ctx.actorId) throw AppError.unauthenticated();
    // The route also carries @OperatorRoles('super_admin'); this is the second lock, for any caller that skips the controller.
    if (ctx.operatorRole !== 'super_admin') {
      throw new AppError(
        ERROR_CODES.AUTH_OPERATOR_ROLE_REQUIRED,
        'This action requires the super admin role.',
        HttpStatus.FORBIDDEN,
      );
    }
    const operatorId = ctx.actorId;
    // Read-only unless the super admin asked for write access in so many words (the schema default is read-only too).
    const readOnly = input.readOnly !== false;
    const now = Date.now();
    const expiresAt = new Date(now + IMPERSONATION_MAX_MINUTES * 60_000);
    const code = randomToken(32);

    const out = await this.store.tx(async (tx) => {
      const org = await this.one<{
        id: number;
        uuid: string;
        name: string;
        settings: Record<string, unknown>;
      }>(tx, sql`SELECT id, uuid, name, settings FROM organizations WHERE uuid = ${orgUuid}::uuid`);
      if (!org) throw AppError.notFound('Workspace', orgUuid);
      const owner = await this.resolveOwner(tx, org.id, org.settings);

      // One open session per operator: starting a new one ends the previous, whichever tab it runs in.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`impersonation:${operatorId}`}, 0))`,
      );
      const prior = await tx.execute(sql`
        UPDATE impersonation_sessions SET ended_at = now(), ended_by = 'new_session'
        WHERE operator_id = ${operatorId} AND ended_at IS NULL
        RETURNING uuid, target_workspace_id
      `);
      for (const p of prior.rows as unknown as Array<{
        uuid: string;
        target_workspace_id: number;
      }>) {
        this.forget(p.uuid);
        await this.audit.record(tx, {
          event: 'platform.impersonation.ended',
          status: 'info',
          orgId: Number(p.target_workspace_id),
          actorType: 'platform_operator',
          actorId: operatorId,
          payload: { sessionId: p.uuid, endedBy: 'new_session' },
        });
      }

      const ins = await tx.execute(sql`
        INSERT INTO impersonation_sessions
          (operator_id, target_workspace_id, target_user_id, reason, read_only, ip, user_agent,
           expires_at, handoff_code_hash, handoff_expires_at)
        VALUES (${operatorId}, ${org.id}, ${owner.id}, ${input.reason}, ${readOnly},
                ${normalizeIp(ctx.ip)}, ${ctx.userAgent?.slice(0, 500) ?? null},
                ${expiresAt.toISOString()}::timestamptz, ${sha256Hex(code)},
                ${new Date(now + IMPERSONATION_HANDOFF_SECONDS * 1000).toISOString()}::timestamptz)
        RETURNING uuid
      `);
      const sessionId = (ins.rows[0] as unknown as { uuid: string }).uuid;
      const operatorUuid = (
        await this.one<{ uuid: string }>(
          tx,
          sql`SELECT uuid FROM platform_operators WHERE id = ${operatorId}`,
        )
      )?.uuid;

      await this.audit.record(tx, {
        event: 'platform.impersonation.started',
        status: 'success',
        orgId: org.id,
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          sessionId,
          reason: input.reason,
          readOnly,
          operatorId: operatorUuid,
          asUserId: owner.uuid,
          expiresAt: expiresAt.toISOString(),
        },
      });
      // The workspace's own trail (its Activity Log): both actors, so the customer can see who was in and as whom.
      await this.tenantTrail(
        tx,
        org.id,
        owner.id,
        'impersonation.started',
        {
          operatorId: operatorUuid ?? null,
          asUserId: owner.uuid,
          sessionId,
          reason: input.reason,
          readOnly,
        },
        operatorId,
      );
      return { sessionId, org, owner };
    });

    return {
      sessionId: out.sessionId,
      workspaceId: out.org.uuid,
      workspaceName: out.org.name,
      handoffUrl: `${this.config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '')}/impersonate?code=${code}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * The workspace's owner: `organizations.settings.ownerUserId` (the owner's uuid), else the oldest active holder of the
   * admin preset. Never a disabled account; an operator must not wake one up by acting as it.
   */
  private async resolveOwner(
    tx: Tx,
    orgId: number,
    settings: Record<string, unknown>,
  ): Promise<{ id: number; uuid: string; status: string }> {
    const named = typeof settings.ownerUserId === 'string' ? settings.ownerUserId : null;
    // The named owner counts only while active: a migrated or since-disabled owner must not hide the admin-role holder below.
    let owner = named
      ? await this.one<{ id: number; uuid: string; status: string }>(
          tx,
          sql`SELECT id, uuid, status FROM users WHERE org_id = ${orgId} AND uuid::text = ${named} AND status = 'active'`,
        )
      : null;
    if (!owner) {
      owner = await this.one<{ id: number; uuid: string; status: string }>(
        tx,
        sql`
          SELECT u.id, u.uuid, u.status FROM users u
          JOIN user_roles ur ON ur.org_id = u.org_id AND ur.user_id = u.id
          JOIN roles r ON r.org_id = ur.org_id AND r.id = ur.role_id AND r.system_key = 'admin'
          WHERE u.org_id = ${orgId} AND u.status = 'active'
          ORDER BY u.id LIMIT 1`,
      );
    }
    if (!owner) {
      throw new AppError(
        ERROR_CODES.WSP_IMPERSONATION_NO_OWNER,
        'This workspace has no active owner to act as.',
        HttpStatus.CONFLICT,
      );
    }
    return owner;
  }

  // --- redeem (workspace side, public) ---------------------------------------------------------------------------------------

  /**
   * Turns the one-time code into the act-as token. The UPDATE is the single-use gate: only one caller can flip
   * `handoff_used_at`, so a replayed or raced code gets nothing.
   */
  async redeem(code: string): Promise<RedeemImpersonationResponse> {
    const hash = sha256Hex(code);
    const row = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE impersonation_sessions s SET handoff_used_at = now()
        FROM platform_operators o, organizations org
        WHERE s.handoff_code_hash = ${hash} AND s.handoff_used_at IS NULL AND s.handoff_expires_at > now()
          AND s.ended_at IS NULL AND s.expires_at > now()
          AND o.id = s.operator_id AND o.status = 'active' AND o.role = 'super_admin'
          AND org.id = s.target_workspace_id
          AND EXISTS (SELECT 1 FROM users u WHERE u.org_id = s.target_workspace_id AND u.id = s.target_user_id AND u.status = 'active')
        RETURNING s.uuid, s.operator_id, s.target_workspace_id AS org_id, s.target_user_id AS user_id, s.read_only,
                  s.expires_at, o.uuid AS operator_uuid, org.slug AS org_slug,
                  (SELECT uuid FROM users u WHERE u.org_id = s.target_workspace_id AND u.id = s.target_user_id) AS user_uuid
      `);
      return (res.rows[0] ?? null) as unknown as {
        uuid: string;
        operator_id: number;
        org_id: number;
        user_id: number;
        read_only: boolean;
        expires_at: Date;
        operator_uuid: string;
        org_slug: string;
        user_uuid: string;
      } | null;
    });
    if (!row) {
      await this.audit.recordStandalone({
        event: 'platform.impersonation.redeem_failed',
        status: 'failure',
        actorType: 'system',
      });
      throw new AppError(
        ERROR_CODES.WSP_IMPERSONATION_CODE_INVALID,
        'This link is not valid any more. Start again from the console.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const expiresAt = new Date(row.expires_at);
    const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    const claims: TokenClaims & { imp: NonNullable<TokenClaims['imp']> } = {
      sub: Number(row.user_id),
      org: Number(row.org_id),
      typ: 'user',
      uid: row.user_uuid,
      sid: row.uuid,
      ep: await this.epoch.current(),
      imp: {
        sid: row.uuid,
        oid: Number(row.operator_id),
        ro: row.read_only,
        exp: Math.floor(expiresAt.getTime() / 1000),
      },
    };
    const { accessToken, expiresIn } = await this.tokens.issueImpersonation(claims, ttl);
    await this.audit.recordStandalone({
      event: 'platform.impersonation.redeemed',
      status: 'success',
      orgId: Number(row.org_id),
      actorType: 'platform_operator',
      actorId: Number(row.operator_id),
      payload: { sessionId: row.uuid, asUserId: row.user_uuid, readOnly: row.read_only },
    });
    return {
      accessToken,
      expiresIn,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      workspaceSlug: row.org_slug,
    };
  }

  // --- per request (workspace side) ----------------------------------------------------------------------------------------

  /**
   * Called by the JWT guard for every act-as request. Proves the row is still open, unexpired, that its operator still
   * holds the right, and that the token's claims are the row's (a signature alone is not the whole check). Throws 401
   * `WSP_IMPERSONATION_ENDED` otherwise, which the web app turns into "the session ended".
   */
  async assertOpen(claims: TokenClaims): Promise<ImpersonationContext> {
    const imp = claims.imp!;
    const ended = () =>
      new AppError(
        ERROR_CODES.WSP_IMPERSONATION_ENDED,
        'This impersonation session has ended.',
        HttpStatus.UNAUTHORIZED,
      );
    if (await this.tombstoned(imp.sid)) throw ended();

    let hit = this.open.get(imp.sid);
    if (hit && Date.now() - hit.checkedAt <= OPEN_CACHE_MS) openRow.hit();
    else openRow.miss();
    if (!hit || Date.now() - hit.checkedAt > OPEN_CACHE_MS) {
      const row = await this.store.tx((tx) =>
        this.one<SessionRow>(
          tx,
          sql`
          SELECT s.id, s.uuid, s.operator_id, s.target_workspace_id AS org_id, s.target_user_id AS user_id, s.reason,
                 s.read_only, s.started_at, s.expires_at, s.ended_at,
                 o.uuid AS operator_uuid, o.full_name AS operator_name, o.role AS operator_role, o.status AS operator_status
          FROM impersonation_sessions s JOIN platform_operators o ON o.id = s.operator_id
          WHERE s.uuid = ${imp.sid}::uuid`,
        ),
      );
      if (!row || row.ended_at) throw ended();
      if (row.operator_status !== 'active' || row.operator_role !== 'super_admin') {
        await this.close(row.uuid, 'access_revoked');
        throw ended();
      }
      hit = { checkedAt: Date.now(), row };
      this.open.set(imp.sid, hit);
    }
    const row = hit.row;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await this.close(row.uuid, 'expiry');
      throw ended();
    }
    if (
      Number(row.org_id) !== claims.org ||
      Number(row.user_id) !== claims.sub ||
      Number(row.operator_id) !== imp.oid
    ) {
      throw ended();
    }
    return {
      sessionId: row.uuid,
      operatorId: Number(row.operator_id),
      operatorUuid: row.operator_uuid,
      readOnly: row.read_only,
      expiresAt: new Date(row.expires_at),
    };
  }

  /** What the banner shows. */
  async status(): Promise<ImpersonationStatus> {
    const imp = RequestContextStore.require().impersonation;
    if (!imp) {
      return {
        active: false,
        sessionId: null,
        operatorName: null,
        reason: null,
        readOnly: false,
        expiresAt: null,
      };
    }
    const row = this.open.get(imp.sessionId)?.row;
    return {
      active: true,
      sessionId: imp.sessionId,
      operatorName: row?.operator_name ?? null,
      reason: row?.reason ?? null,
      readOnly: imp.readOnly,
      expiresAt: imp.expiresAt.toISOString(),
    };
  }

  // --- stop ---------------------------------------------------------------------------------------------------------------

  /** Ends the caller's own act-as session. A request that is not impersonating changes nothing (Reference: silent redirect). */
  async stop(): Promise<StopImpersonationResponse> {
    const imp = RequestContextStore.require().impersonation;
    if (imp) await this.close(imp.sessionId, 'operator');
    return {
      returnUrl: `${this.config.get('WEB_APP_URL', { infer: true }).replace(/\/+$/, '')}${IMPERSONATION_RETURN_PATH}`,
    };
  }

  /**
   * Ends a session (idempotent), kills its token on the next request everywhere (tombstone) and writes the summary: how many
   * audited changes were made, by action, as Reference's stop summary did.
   */
  async close(sessionUuid: string, endedBy: ImpersonationEndedBy): Promise<void> {
    this.forget(sessionUuid);
    try {
      await this.redis.set(
        AuthKeys.impersonationEnded(sessionUuid),
        '1',
        'EX',
        (IMPERSONATION_MAX_MINUTES + 5) * 60,
      );
    } catch (err) {
      this.logger.warn({ err }, 'impersonation tombstone not written: redis unavailable');
    }
    await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE impersonation_sessions SET ended_at = now(), ended_by = ${endedBy}
        WHERE uuid = ${sessionUuid}::uuid AND ended_at IS NULL
        RETURNING operator_id, target_workspace_id, target_user_id, started_at, ended_at
      `);
      const r = res.rows[0] as unknown as
        | {
            operator_id: number;
            target_workspace_id: number;
            target_user_id: number;
            started_at: Date;
            ended_at: Date;
          }
        | undefined;
      if (!r) return; // already ended: the first closer wrote the summary
      const summary = await tx.execute(sql`
        SELECT action, count(*)::int AS n FROM audit_log
        WHERE org_id = ${r.target_workspace_id} AND actor_id = ${r.target_user_id} AND at >= ${new Date(r.started_at).toISOString()}::timestamptz
          AND delta -> '_impersonatedBy' -> 'new' ->> 'sessionId' = ${sessionUuid}
        GROUP BY action ORDER BY n DESC LIMIT 50
      `);
      const byAction = Object.fromEntries(
        (summary.rows as unknown as Array<{ action: string; n: number }>).map((x) => [
          x.action,
          x.n,
        ]),
      );
      const total = Object.values(byAction).reduce((a, b) => a + b, 0);
      const durationSeconds = Math.round(
        (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 1000,
      );
      const operatorUuid = (
        await this.one<{ uuid: string }>(
          tx,
          sql`SELECT uuid FROM platform_operators WHERE id = ${r.operator_id}`,
        )
      )?.uuid;
      const payload = {
        sessionId: sessionUuid,
        endedBy,
        durationSeconds,
        totalEvents: total,
        eventsByAction: byAction,
      };
      await this.audit.record(tx, {
        event: 'platform.impersonation.stopped',
        status: 'info',
        orgId: Number(r.target_workspace_id),
        actorType: 'platform_operator',
        actorId: Number(r.operator_id),
        payload: { ...payload, operatorId: operatorUuid },
      });
      await this.tenantTrail(
        tx,
        Number(r.target_workspace_id),
        Number(r.target_user_id),
        'impersonation.stopped',
        { ...payload, operatorId: operatorUuid ?? null },
        Number(r.operator_id),
      );
    });
  }

  // --- helpers ------------------------------------------------------------------------------------------------------------

  /** Drops the local cache entry (the Redis tombstone covers other instances). */
  forget(sessionUuid: string): void {
    this.open.delete(sessionUuid);
  }

  private async tombstoned(sessionUuid: string): Promise<boolean> {
    try {
      const ended = Boolean(await this.redis.get(AuthKeys.impersonationEnded(sessionUuid)));
      if (ended) tombstone.hit();
      else tombstone.miss();
      return ended;
    } catch {
      tombstone.error();
      return false; // fail open like the session check: the row read below still decides
    }
  }

  /** One row of the workspace's own audit trail, written by the operator (actor_type platform_operator). */
  private async tenantTrail(
    tx: Tx,
    orgId: number,
    targetUserId: number,
    action: string,
    fields: Record<string, unknown>,
    operatorId: number,
  ): Promise<void> {
    const delta = Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, { old: null, new: v }]),
    );
    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
      VALUES (${orgId}, ${operatorId}, 'platform_operator', 'impersonation', ${targetUserId}, ${action},
              ${JSON.stringify(delta)}::jsonb, ${RequestContextStore.peek()?.requestId ?? null})
    `);
  }

  private async one<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T | null> {
    const res = await tx.execute(query);
    return (res.rows[0] as unknown as T | undefined) ?? null;
  }
}
