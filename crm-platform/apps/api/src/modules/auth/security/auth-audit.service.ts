import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import { normalizeIp } from '../support/ip';

export type SecurityStatus = 'success' | 'failure' | 'warning' | 'info';

export interface SecurityEventInput {
  /** Dotted, e.g. auth.login, auth.lockout, platform.security.policy_updated. */
  event: string;
  status: SecurityStatus;
  orgId?: number | null;
  actorType?: string;
  actorId?: number | null;
  /** Per-user trail: audit_log.record_id. Omit for events with no subject. */
  recordId?: number | null;
  payload?: Record<string, unknown>;
}

const SECRET_KEY = /pass(word)?|secret|token|code|authorization|credential|api[_-]?key|cookie/i;

/** Keys that look like secrets are replaced, at any depth, before anything is stored. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SECRET_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1),
    ]),
  );
}

/**
 * Writes security-relevant events (WD-AUTH-046).
 *
 * Two sinks, one call:
 *   - security_events: every event, across tenants, readable only by operators
 *     (feeds the Security Center KPIs and risk queue)
 *   - audit_log: the per-user trail inside the tenant (login, logout, password
 *     change, MFA, sessions...), visible in the workspace Activity Log
 *
 * Passing a `tx` writes both in the caller's transaction, which is the point:
 * the event and the change commit or roll back together. Failure paths that
 * throw (and so roll back) use `recordStandalone`, which opens its own
 * transaction so "login failed" survives the rejected request.
 */
@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger(AuthAuditService.name);

  constructor(private readonly db: DatabaseService) {}

  async record(tx: Tx, input: SecurityEventInput): Promise<void> {
    const ctx = RequestContextStore.peek();
    const orgId = input.orgId ?? (ctx && ctx.orgId > 0 ? ctx.orgId : null);
    const actorType = input.actorType ?? ctx?.actorType ?? 'system';
    const actorId = input.actorId ?? ctx?.actorId ?? null;
    const ip = normalizeIp(ctx?.ip);
    const payload = JSON.stringify(redact(input.payload ?? {}));

    await tx.execute(sql`
      INSERT INTO security_events (subject_org_id, actor_type, actor_id, event, status, ip, user_agent, request_id, payload)
      VALUES (${orgId}, ${actorType}, ${actorId}, ${input.event}, ${input.status},
              ${ip}::inet, ${ctx?.userAgent ?? null}, ${ctx?.requestId ?? null}, ${payload}::jsonb)
    `);

    if (orgId && actorType !== 'platform_operator') {
      await tx.execute(sql`
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id, ip)
        VALUES (${orgId}, ${actorId}, ${actorType}, 'auth', ${input.recordId ?? actorId ?? 0},
                ${input.event}, ${payload}::jsonb, ${ctx?.requestId ?? null}, ${ip}::inet)
      `);
    }
  }

  /** Own transaction. Never throws: auditing must not turn a refusal into a 500. */
  async recordStandalone(input: SecurityEventInput): Promise<void> {
    try {
      const ctx = RequestContextStore.peek();
      const orgId = input.orgId ?? (ctx && ctx.orgId > 0 ? ctx.orgId : null);
      if (orgId) {
        await this.db.txAs({ orgId, userId: input.actorId ?? null }, (tx) =>
          this.record(tx, { ...input, orgId }),
        );
      } else {
        // No tenant (unknown org slug, operator login): security_events only.
        // Its INSERT policy admits any connection, so no privilege is needed.
        const c = RequestContextStore.peek();
        const ip = normalizeIp(c?.ip);
        await this.db.primary.execute(sql`
          INSERT INTO security_events (subject_org_id, actor_type, actor_id, event, status, ip, user_agent, request_id, payload)
          VALUES (${null}, ${input.actorType ?? c?.actorType ?? 'system'}, ${input.actorId ?? c?.actorId ?? null},
                  ${input.event}, ${input.status}, ${ip}::inet, ${c?.userAgent ?? null},
                  ${c?.requestId ?? null}, ${JSON.stringify(redact(input.payload ?? {}))}::jsonb)
        `);
      }
    } catch (err) {
      this.logger.error({ err, event: input.event }, 'failed to record security event');
    }
  }
}
