import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type DangerActionResponse,
  type SecurityEventListQuery,
  type SecurityOverviewResponse,
  type SecurityPolicy,
  type SecurityPolicyPatch,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import type { Env } from '../../../config/env.schema';
import { EpochService } from '../sessions/epoch.service';
import { AccountGateService } from '../security/account-gate.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { EmergencyHaltService } from '../security/emergency-halt.service';
import { ipAllowed, normalizeIp } from '../support/ip';
import { isStrictAllowlistEntry } from './ip-allowlist';
import { OperatorAuthService } from './operator-auth.service';
import { PlatformStore } from './platform-store';
import { SecurityPolicyService } from './security-policy.service';
import { TenantDirectory } from './tenant-directory';
import { WebhookSecretRegistry } from '../security/webhook-secret-registry';

/** What each control actually does today. The admin screen shows this verbatim. */
const ENFORCEMENT: SecurityOverviewResponse['enforcement'] = [
  {
    key: 'requireMfaForAll / requireMfaForAdmins / requireMfaForOwners',
    controls: ['requireMfaForAll', 'requireMfaForAdmins', 'requireMfaForOwners'],
    consumer: 'Account gate guard (MFA_ENROLMENT_REQUIRED)',
    status: 'enforced',
  },
  {
    key: 'allowedMfaMethods',
    controls: ['allowedMfaMethods'],
    consumer: 'Only authenticator apps exist',
    status: 'reserved',
  },
  {
    key: 'sessionTimeoutMinutes',
    controls: ['sessionTimeoutMinutes'],
    consumer: 'JWT guard + refresh (non-remembered sessions)',
    status: 'enforced',
  },
  {
    key: 'maxConcurrentSessions',
    controls: ['maxConcurrentSessions'],
    consumer: 'Session creation (oldest revoked)',
    status: 'enforced',
  },
  {
    key: 'rememberMeEnabled',
    controls: ['rememberMeEnabled'],
    consumer: 'Login',
    status: 'enforced',
  },
  {
    key: 'lockoutAfterFailures / lockoutWindowMinutes',
    controls: ['lockoutAfterFailures', 'lockoutWindowMinutes'],
    consumer: 'Login (per organization, email and IP)',
    status: 'enforced',
  },
  {
    key: 'passwordMinLength / Upper / Number / Symbol',
    controls: [
      'passwordMinLength',
      'passwordRequireUpper',
      'passwordRequireNumber',
      'passwordRequireSymbol',
    ],
    consumer: 'Sign-up, reset, change and operator passwords',
    status: 'enforced',
  },
  {
    key: 'passwordMaxAgeDays',
    controls: ['passwordMaxAgeDays'],
    consumer: 'Account gate guard (PASSWORD_CHANGE_REQUIRED)',
    status: 'enforced',
  },
  {
    key: 'waGuardrailsMode and the caps / filters',
    controls: [
      'waGuardrailsMode',
      'waMaxSendsPerMinute',
      'waMaxSendsPerDay',
      'waHoldOnLinksCount',
      'waHoldOnScamPattern',
      'abuseBlockShortLinks',
      'abuseBlockFinanceTerms',
      'abuseBlockKeywordList',
    ],
    consumer: 'Outbound send guard on every WhatsApp provider call (halt, content, rate caps)',
    status: 'enforced',
  },
  {
    key: 'waRequireTemplateReview',
    controls: ['waRequireTemplateReview'],
    consumer: 'Nothing yet',
    status: 'reserved',
  },
  {
    key: 'apiRateLimitPerMinute',
    controls: ['apiRateLimitPerMinute'],
    // Reference lets a plan's own value win over the global one; here the global value is a
    // ceiling no key (or plan) can exceed, and a key with no limit of its own gets it.
    consumer:
      "Public API key guard: a platform-wide ceiling over every key's own limit, never raised by a plan",
    status: 'enforced',
  },
  {
    key: 'webhookSignatureRequired',
    controls: ['webhookSignatureRequired'],
    // Nothing reads it yet (webhook signatures are always checked on inbound
    // provider webhooks, whatever this says), so it must not claim enforcement.
    consumer: 'Reserved: no webhook code reads this switch yet',
    status: 'reserved',
  },
  {
    key: 'webhookReplayWindowSec / deviceTrustRequired',
    controls: ['webhookReplayWindowSec', 'deviceTrustRequired'],
    consumer: 'Reserved',
    status: 'reserved',
  },
  {
    key: 'deviceLogoutOnInactiveDays',
    controls: ['deviceLogoutOnInactiveDays'],
    consumer: 'WhatsApp device heartbeat (device domain)',
    status: 'partial',
  },
  {
    key: 'ipAllowlistEnabled / ipAllowlistCidrs',
    controls: ['ipAllowlistEnabled', 'ipAllowlistCidrs'],
    consumer: 'Operator guard on /platform/*',
    status: 'enforced',
  },
  {
    key: 'alertOnNewDevice / alertOnNewCountry / alertChannel',
    controls: ['alertOnNewDevice', 'alertOnNewCountry', 'alertChannel'],
    consumer: 'Login alert (email; WhatsApp channel not sent)',
    status: 'enforced',
  },
  {
    key: 'auditLogRetentionDays',
    controls: ['auditLogRetentionDays'],
    consumer: 'Daily prune of audit_log and security_events (worker)',
    status: 'enforced',
  },
];

const toIso = (d: Date | string): string => (d instanceof Date ? d : new Date(d)).toISOString();

/**
 * One short line about what the event was about: an explicit label, else the
 * identifier, reason or route the writer recorded. '' when there is nothing
 * beyond the event name, which the screen then leaves out instead of printing twice.
 */
export function riskDetail(event: string, payload: Record<string, unknown> | null): string {
  for (const key of ['_label', 'label', 'identifier', 'reason', 'route']) {
    const v = payload?.[key];
    if (typeof v === 'string' && v.trim() && v !== event) return v.trim().slice(0, 200);
  }
  return '';
}

/**
 * The platform Security Center (TW-AUTH-036/037/039/040): read model over
 * security_events, the typed policy document, and the super-admin-only danger
 * actions. Every mutation writes one audit event.
 */
@Injectable()
export class SecurityCenterService {
  private readonly appName: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly store: PlatformStore,
    private readonly policyService: SecurityPolicyService,
    private readonly halt: EmergencyHaltService,
    private readonly epoch: EpochService,
    private readonly tenants: TenantDirectory,
    private readonly operators: OperatorAuthService,
    private readonly audit: AuthAuditService,
    private readonly gates: AccountGateService,
    private readonly webhookSecrets: WebhookSecretRegistry,
  ) {
    this.appName = config.get('APP_NAME', { infer: true });
  }

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  async overview(): Promise<SecurityOverviewResponse> {
    const [policy, halted, totals, agg, risks] = await Promise.all([
      this.policyService.storedPolicy(),
      this.halt.isHalted(),
      this.operatorTotals(),
      this.aggregates(),
      this.recentRisks(),
    ]);

    return {
      appName: this.appName,
      policy,
      emergencyHalt: halted,
      kpis: {
        score: this.score(policy),
        openRisks: agg.openRisks,
        highPriorityRisks: agg.highRisks,
        blockedAttempts24h: agg.blocked24h,
        warnings24h: agg.warnings24h,
        operatorMfa: totals,
        webhookFailurePct: agg.webhookFailurePct,
      },
      risks,
      coverage: this.coverage(policy, halted),
      enforcement: ENFORCEMENT,
      yourIp: normalizeIp(RequestContextStore.peek()?.ip),
    };
  }

  /** Ten points per enabled control. */
  private score(p: SecurityPolicy): number {
    const controls = [
      p.requireMfaForAdmins,
      p.waHoldOnScamPattern,
      p.waRequireTemplateReview,
      p.abuseBlockFinanceTerms,
      p.abuseBlockShortLinks,
      p.webhookSignatureRequired,
      p.alertOnNewDevice,
      p.alertOnNewCountry,
      p.sessionTimeoutMinutes > 0,
      p.lockoutAfterFailures > 0,
    ];
    return controls.filter(Boolean).length * 10;
  }

  private coverage(p: SecurityPolicy, halted: boolean): SecurityOverviewResponse['coverage'] {
    const bucket = (key: SecurityOverviewResponse['coverage'][number]['key'], flags: boolean[]) => {
      const enabled = flags.filter(Boolean).length;
      return {
        key,
        percent: Math.round((enabled / flags.length) * 100),
        enabled,
        total: flags.length,
      };
    };
    return [
      bucket('admin_access', [
        p.requireMfaForAdmins,
        p.lockoutAfterFailures > 0,
        p.sessionTimeoutMinutes > 0,
        p.maxConcurrentSessions > 0,
      ]),
      bucket('send_abuse', [
        p.waHoldOnScamPattern,
        p.waRequireTemplateReview,
        p.abuseBlockFinanceTerms,
        p.abuseBlockShortLinks,
      ]),
      bucket('api_hardening', [
        p.webhookSignatureRequired,
        p.apiRateLimitPerMinute > 0,
        p.webhookReplayWindowSec > 0,
      ]),
      bucket('incident_readiness', [p.alertOnNewDevice, p.alertOnNewCountry, !halted]),
    ];
  }

  private async operatorTotals(): Promise<{ enrolled: number; total: number }> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE mfa_enabled)::int AS enrolled
        FROM platform_operators WHERE status = 'active'
      `);
      return res.rows[0] as unknown as { enrolled: number; total: number };
    });
  }

  private async aggregates(): Promise<{
    openRisks: number;
    highRisks: number;
    blocked24h: number;
    warnings24h: number;
    webhookFailurePct: number;
  }> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT
          count(*) FILTER (WHERE status IN ('failure','warning') AND at > now() - interval '7 days')::int AS open_risks,
          count(*) FILTER (WHERE status = 'failure' AND at > now() - interval '7 days')::int AS high_risks,
          count(*) FILTER (WHERE event IN ('auth.failed','platform.auth.failed') AND at > now() - interval '24 hours')::int AS blocked,
          count(*) FILTER (WHERE status = 'warning' AND at > now() - interval '24 hours')::int AS warnings,
          count(*) FILTER (WHERE event LIKE '%webhook%' AND at > now() - interval '24 hours')::int AS hooks,
          count(*) FILTER (WHERE event LIKE '%webhook%' AND status = 'failure' AND at > now() - interval '24 hours')::int AS hook_fail
        FROM security_events
        WHERE at > now() - interval '7 days'
      `);
      const r = res.rows[0] as unknown as {
        open_risks: number;
        high_risks: number;
        blocked: number;
        warnings: number;
        hooks: number;
        hook_fail: number;
      };
      return {
        openRisks: r.open_risks,
        highRisks: r.high_risks,
        blocked24h: r.blocked,
        warnings24h: r.warnings,
        webhookFailurePct: r.hooks === 0 ? 0 : Math.round((r.hook_fail / r.hooks) * 10_000) / 100,
      };
    });
  }

  private async recentRisks(): Promise<SecurityOverviewResponse['risks']> {
    return this.store.tx(async (tx) => {
      // The newest four failure or warning rows inside the 7-day window the
      // "open risks" figure uses. The owner is the person's name, looked up in
      // the table the actor type names; a row with no actor id is the system's.
      const res = await tx.execute(sql`
        SELECT e.at, e.event, e.status, e.actor_type, e.actor_id, e.payload, o.name AS org_name,
               CASE e.actor_type
                 WHEN 'user' THEN (
                   SELECT u.full_name FROM users u
                   WHERE u.org_id = e.subject_org_id AND u.id = e.actor_id)
                 WHEN 'platform_operator' THEN (
                   SELECT po.full_name FROM platform_operators po WHERE po.id = e.actor_id)
               END AS actor_name
        FROM security_events e LEFT JOIN organizations o ON o.id = e.subject_org_id
        WHERE e.status IN ('failure','warning') AND e.at > now() - interval '7 days'
        ORDER BY e.at DESC, e.id DESC LIMIT 4
      `);
      return (
        res.rows as unknown as Array<{
          at: Date;
          event: string;
          status: string;
          actor_type: string;
          actor_id: number | string | null;
          payload: Record<string, unknown>;
          org_name: string | null;
          actor_name: string | null;
        }>
      ).map((r) => {
        const kind: 'user' | 'platform_operator' | 'system' =
          r.actor_id === null
            ? 'system'
            : r.actor_type === 'platform_operator'
              ? 'platform_operator'
              : r.actor_type === 'user'
                ? 'user'
                : 'system';
        const actor =
          kind === 'system'
            ? 'System'
            : (r.actor_name ??
              (kind === 'platform_operator'
                ? `Operator #${String(r.actor_id)}`
                : `User #${String(r.actor_id)}`));
        return {
          severity:
            r.status === 'failure' && Date.now() - new Date(r.at).getTime() < 86_400_000
              ? ('high' as const)
              : r.status === 'failure'
                ? ('medium' as const)
                : ('watch' as const),
          signal: r.event,
          detail: riskDetail(r.event, r.payload),
          workspace: r.org_name,
          scope: r.org_name
            ? ('workspace' as const)
            : r.actor_type === 'platform_operator' || r.event.startsWith('platform.')
              ? ('platform' as const)
              : ('none' as const),
          actor,
          actorKind: kind,
          at: toIso(r.at),
        };
      });
    });
  }

  // --- policy ----------------------------------------------------------------------------------------------

  async patchPolicy(patch: SecurityPolicyPatch): Promise<SecurityOverviewResponse> {
    const operatorId = this.operatorId();
    const callerIp = normalizeIp(RequestContextStore.peek()?.ip);

    if (patch.ipAllowlistCidrs) {
      // Strict: `10.0.0.5/` or `x/` must be refused here; read leniently they become /0.
      const bad = patch.ipAllowlistCidrs.filter((e) => !isStrictAllowlistEntry(e));
      if (bad.length > 0) {
        throw AppError.validation(
          'Some allowlist entries are not valid addresses or ranges',
          bad.map((e) => ({ path: 'ipAllowlistCidrs', message: `Invalid entry: ${e}` })),
        );
      }
    }
    // Self-lockout guard: Reference let an admin enable an allowlist that excluded
    // their own address. Refuse unless the caller is on the resulting list.
    const current = await this.policyService.policy();
    const nextEnabled = patch.ipAllowlistEnabled ?? current.ipAllowlistEnabled;
    const nextList = patch.ipAllowlistCidrs ?? current.ipAllowlistCidrs;
    if (nextEnabled && nextList.length > 0) {
      // Not knowing the caller's address is not a pass: an allowlist saved blind
      // would shut this operator out on the very next request.
      if (!callerIp) {
        throw AppError.validation('Your own address could not be read', [
          {
            path: 'ipAllowlistCidrs',
            message: 'We cannot tell which address you are using, so the allowlist was not saved.',
          },
        ]);
      }
      if (!ipAllowed(callerIp, nextList)) {
        throw AppError.validation('Your own address is not on the allowlist', [
          { path: 'ipAllowlistCidrs', message: `Add ${callerIp} before enabling the allowlist.` },
        ]);
      }
    }

    const { changes } = await this.policyService.patchPolicy(patch, operatorId);
    if (Object.keys(changes).length > 0) {
      await this.gates.invalidateAll();
      await this.audit.recordStandalone({
        event: 'platform.security.policy_updated',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { fields: Object.keys(changes), changes },
      });
    }
    return this.overview();
  }

  // --- danger zone (super admin only; the route's OperatorRoles guard enforces it) ----------------------------

  async revokeAllSessions(): Promise<DangerActionResponse> {
    const operatorId = this.operatorId();
    await this.epoch.bump(operatorId);
    const [tenant, ops] = await Promise.all([
      this.tenants.revokeAllTenantSessions(),
      this.operators.revokeAllSessions(),
    ]);
    const affected = tenant + ops;
    await this.audit.recordStandalone({
      event: 'platform.security.sessions_revoked',
      status: 'warning',
      actorType: 'platform_operator',
      actorId: operatorId,
      payload: { affected },
    });
    return { action: 'revoke_sessions', affected };
  }

  async forcePasswordReset(): Promise<DangerActionResponse> {
    const operatorId = this.operatorId();
    const affected = await this.tenants.forceResetAllUsers();
    await this.gates.invalidateAll();
    await this.audit.recordStandalone({
      event: 'platform.security.force_password_reset_all',
      status: 'warning',
      actorType: 'platform_operator',
      actorId: operatorId,
      payload: { affected },
    });
    return { action: 'force_password_reset', affected };
  }

  /**
   * Reference's version rotated zero secrets because the column it targeted did
   * not exist. Webhook signing secrets belong to the domains that store them;
   * each registers a rotator with `WebhookSecretRegistry`, and this rotates all
   * of them and reports the real count (0 until one registers).
   */
  async rotateWebhookSecrets(): Promise<DangerActionResponse> {
    const operatorId = this.operatorId();
    const result = await this.webhookSecrets.rotateAll();
    await this.audit.recordStandalone({
      event: 'platform.security.webhook_secrets_rotated',
      status: 'warning',
      actorType: 'platform_operator',
      actorId: operatorId,
      payload: {
        rotated: result.total,
        byRotator: result.byRotator,
        failed: result.failed,
        ...(this.webhookSecrets.names().length === 0
          ? { note: 'no domain has registered webhook secret storage yet' }
          : {}),
      },
    });
    return { action: 'rotate_webhook_secrets', affected: result.total };
  }

  async setHalt(halted: boolean): Promise<DangerActionResponse> {
    const operatorId = this.operatorId();
    await this.halt.set(halted, operatorId);
    await this.audit.recordStandalone({
      event: halted
        ? 'platform.security.emergency_halt_engaged'
        : 'platform.security.emergency_halt_released',
      status: halted ? 'warning' : 'success',
      actorType: 'platform_operator',
      actorId: operatorId,
    });
    return { action: halted ? 'halt_sends' : 'resume_sends', affected: 0 };
  }

  // --- event stream -----------------------------------------------------------------------------------------------------

  async events(query: SecurityEventListQuery) {
    const rows = await this.store.tx(async (tx) => {
      let cursor: { at: string; id: number } | null = null;
      if (query.cursor) {
        const [at, id] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
        if (at && id && !Number.isNaN(new Date(at).getTime())) cursor = { at, id: Number(id) };
      }
      const like = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      // The actor id on the row is internal; the viewer gets the public uuid, name
      // and email, resolved from the table the actor type names (an account
      // deleted since is simply null).
      const res = await tx.execute(sql`
        SELECT e.id, e.at, e.event, e.status, e.actor_type,
               o.uuid AS org_uuid, o.slug AS org_slug, o.name AS org_name,
               host(e.ip) AS ip, e.user_agent, e.request_id, e.payload,
               a.uuid AS actor_uuid, a.name AS actor_name, a.email AS actor_email
        FROM security_events e
        LEFT JOIN organizations o ON o.id = e.subject_org_id
        LEFT JOIN LATERAL (
          SELECT u.uuid, u.full_name AS name, u.email::text AS email
            FROM users u WHERE e.actor_type = 'user' AND u.org_id = e.subject_org_id AND u.id = e.actor_id
          UNION ALL
          SELECT po.uuid, po.full_name, po.email::text
            FROM platform_operators po WHERE e.actor_type = 'platform_operator' AND po.id = e.actor_id
        ) a ON true
        WHERE (${query.event ?? null}::text IS NULL OR e.event = ${query.event ?? null})
          AND (${query.status ?? null}::text IS NULL OR e.status = ${query.status ?? null})
          AND (${like}::text IS NULL OR e.event ILIKE ${like} ESCAPE '\\')
          AND (${cursor?.at ?? null}::timestamptz IS NULL OR (e.at, e.id) < (${cursor?.at ?? null}::timestamptz, ${cursor?.id ?? null}::bigint))
        ORDER BY e.at DESC, e.id DESC
        LIMIT ${query.limit + 1}
      `);
      return res.rows as unknown as Array<{
        id: number;
        at: Date;
        event: string;
        status: 'success' | 'failure' | 'warning' | 'info';
        actor_type: string;
        org_uuid: string | null;
        org_slug: string | null;
        org_name: string | null;
        ip: string | null;
        user_agent: string | null;
        request_id: string | null;
        payload: Record<string, unknown>;
        actor_uuid: string | null;
        actor_name: string | null;
        actor_email: string | null;
      }>;
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    return {
      data: page.map((r) => ({
        // Opaque: the row number is not a public identifier and nothing addresses an event by it.
        id: Buffer.from(`evt:${r.id}`).toString('base64url'),
        at: toIso(r.at),
        event: r.event,
        status: r.status,
        actorType: r.actor_type,
        actorId: r.actor_uuid,
        actorName: r.actor_name,
        actorEmail: r.actor_email,
        orgId: r.org_uuid,
        orgSlug: r.org_slug,
        orgName: r.org_name,
        ip: r.ip,
        userAgent: r.user_agent,
        requestId: r.request_id,
        payload: r.payload,
      })),
      page: {
        nextCursor:
          hasMore && last
            ? Buffer.from(`${toIso(last.at)}|${last.id}`).toString('base64url')
            : null,
        hasMore,
        limit: query.limit,
      },
    };
  }
}

void ERROR_CODES;
