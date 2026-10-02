import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { securityPolicySchema } from '@crm/contracts';
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

/**
 * Key names whose value is a secret (TW-AUTH-046). This is the union of the
 * reference product's list and ours: password, secret, token, API / access /
 * client keys, credentials, private material, webhook and signing values,
 * bearer and authorization headers, cookies, and one-time codes.
 */
const SECRET_KEY = new RegExp(
  [
    'passw(?:or)?d',
    'passphrase',
    'secret',
    'token',
    'api[_-]?key',
    'access[_-]?key',
    'credential',
    'private',
    'webhook',
    'signing',
    'bearer',
    'authorization',
    'cookie',
    // A bare "code" is an OAuth or one-time code; "country_code" and friends are not matched.
    '^code$',
    '(?:otp|totp|mfa|recovery|verification|backup|auth)[_-]?codes?$',
  ].join('|'),
  'i',
);

/**
 * Names that look secret but carry configuration or a list of other names,
 * never a secret value: the security-POLICY settings an administrator changes
 * (the audit diff of `passwordMinLength` must stay readable) and the lists of
 * key names other writers record on purpose.
 */
const NOT_SECRET_KEYS = new Set([
  // Every security-policy setting: `passwordMinLength`, `webhookSignatureRequired` and
  // `webhookReplayWindowSec` are switches and numbers that merely have a secret-sounding word in their name.
  ...Object.keys(securityPolicySchema.shape),
  'credential_keys_set',
  'credentialKeysSet',
  'missing_keys',
  'missingKeys',
  'changed_keys',
  'changedKeys',
]);

/** A payload nested deeper than this is cut, not stored: a secret hidden at depth 12 must not survive. */
const MAX_DEPTH = 10;

/** A bare number under a secret-sounding name is a count ("webhooks": 4), unless the name says it is the secret itself. */
const NUMERIC_SECRET_KEY = /passw|secret|token|code|otp|pin\b|key/i;
const isHarmlessNumber = (k: string, v: unknown): boolean =>
  typeof v === 'number' && !NUMERIC_SECRET_KEY.test(k);

const isEmpty = (v: unknown): boolean =>
  v === null ||
  v === '' ||
  v === false ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * Replaces the value of every secret-looking key, at any depth, before anything
 * is stored. Key names stay, so the trail still shows what changed. A null,
 * empty or false value is kept: there is nothing to hide, and "the secret was
 * cleared" is information worth keeping.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SECRET_KEY.test(k) && !NOT_SECRET_KEYS.has(k) && !isEmpty(v) && !isHarmlessNumber(k, v)
        ? '[REDACTED]'
        : redact(v, depth + 1),
    ]),
  );
}

/**
 * Writes security-relevant events (TW-AUTH-046).
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
