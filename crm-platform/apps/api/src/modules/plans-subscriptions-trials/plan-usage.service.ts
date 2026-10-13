import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  PLAN_FEATURE_KEYS,
  PLAN_UPGRADE_PATH,
  type BillingUsageResponse,
  type PlanLimitKey,
  type UsageMeter,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  PlanEntitlementService,
  resolveFeature,
  resolveLimit,
  type Entitlements,
} from './plan-entitlement.service';
import { monthStart, nextMonthStart, validityForState } from './plan-lifecycle';

/**
 * One count per capped key, in the order the usage panel lists them (TW-PLAN-014). Each count is the same one the
 * enforcing module uses before it blocks row N+1, so the meter and the 422 can never disagree:
 *   contacts      contacts of the workspace          (ContactQuotaService)
 *   users         seats: every user not inactive     (MembersRepository.seatsUsed)
 *   appointments  booked this calendar month         (AppointmentsRepository.countInRange)
 * The remaining keys count the workspace's rows of that kind. Message use is outbound messages created this month.
 * `window` says whether the counter resets monthly.
 */
const METERS: ReadonlyArray<{
  key: PlanLimitKey;
  window: 'month' | 'total';
  count: (tx: Tx, orgId: number, from: Date, to: Date) => Promise<number>;
}> = [
  {
    key: 'monthly_messages',
    window: 'month',
    count: (tx, orgId, from, to) =>
      n(
        tx,
        sql`SELECT count(*)::int AS n FROM messages
        WHERE org_id = ${orgId} AND direction = 'out' AND kind <> 'reaction'
          AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz`,
      ),
  },
  {
    // SMS accepted by the provider this calendar month: the ledger the SMS sender reserves from (`plan_usage`, metric `sms_sent`).
    key: 'sms_monthly',
    window: 'month',
    count: (tx, orgId, from) =>
      n(
        tx,
        sql`SELECT coalesce(sum(count), 0)::int AS n FROM plan_usage
            WHERE org_id = ${orgId} AND metric = 'sms_sent'
              AND period = ${`${from.getUTCFullYear()}${String(from.getUTCMonth() + 1).padStart(2, '0')}`}`,
      ),
  },
  {
    key: 'contacts',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM contacts WHERE org_id = ${orgId}`),
  },
  {
    key: 'devices',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM devices WHERE org_id = ${orgId}`),
  },
  {
    key: 'users',
    window: 'total',
    count: (tx, orgId) =>
      n(
        tx,
        sql`SELECT count(*)::int AS n FROM users WHERE org_id = ${orgId} AND status <> 'inactive'`,
      ),
  },
  {
    key: 'flows',
    window: 'total',
    count: (tx, orgId) => n(tx, sql`SELECT count(*)::int AS n FROM flows WHERE org_id = ${orgId}`),
  },
  {
    key: 'templates',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM wa_templates WHERE org_id = ${orgId}`),
  },
  {
    // Campaigns created in this plan period, deleted ones included (the quota ledger, TW-PLAN-018): the number the create check reads.
    key: 'total_campaigns',
    window: 'total',
    count: (tx, orgId) =>
      n(
        tx,
        sql`SELECT coalesce(sum(count), 0)::int AS n FROM plan_usage
            WHERE org_id = ${orgId} AND metric = 'campaign'
              AND period = (SELECT o.plan || '|' || coalesce(to_char(s.plan_ends_at AT TIME ZONE 'UTC', 'YYYYMMDD'), '0')
                            FROM organizations o LEFT JOIN org_plan_state s ON s.org_id = o.id WHERE o.id = ${orgId})`,
      ),
  },
  {
    key: 'broadcasts',
    window: 'total',
    count: (tx, orgId) =>
      n(
        tx,
        sql`SELECT count(*)::int AS n FROM broadcasts WHERE org_id = ${orgId} AND NOT archived`,
      ),
  },
  {
    key: 'autoreplies',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM keyword_replies WHERE org_id = ${orgId}`),
  },
  {
    key: 'tags',
    window: 'total',
    count: (tx, orgId) => n(tx, sql`SELECT count(*)::int AS n FROM tags WHERE org_id = ${orgId}`),
  },
  {
    key: 'pipelines',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM pipelines WHERE org_id = ${orgId}`),
  },
  {
    key: 'appointments',
    window: 'month',
    count: (tx, orgId, from, to) =>
      n(
        tx,
        sql`SELECT count(*)::int AS n FROM appointments
        WHERE org_id = ${orgId} AND status IN ('pending', 'confirmed', 'completed')
          AND starts_at >= ${from.toISOString()}::timestamptz AND starts_at < ${to.toISOString()}::timestamptz`,
      ),
  },
  {
    key: 'scheduled_messages',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM scheduled_messages WHERE org_id = ${orgId}`),
  },
  {
    key: 'saved_replies',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM saved_replies WHERE org_id = ${orgId}`),
  },
  {
    key: 'routing_rules',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM routing_rules WHERE org_id = ${orgId}`),
  },
  {
    // Every install row, whatever its status (the marketplace's own check counts the same set).
    key: 'installed_apps',
    window: 'total',
    count: (tx, orgId) =>
      n(
        tx,
        sql`SELECT count(*)::int AS n FROM workspace_app_installations WHERE org_id = ${orgId}`,
      ),
  },
  {
    key: 'lead_sources',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM lead_sources WHERE org_id = ${orgId}`),
  },
  {
    // The biggest audience among the broadcasts that are not archived: the number a new broadcast is compared with is its own size.
    key: 'broadcast_recipients',
    window: 'total',
    count: (tx, orgId) =>
      n(
        tx,
        sql`SELECT coalesce(max(total_recipients), 0)::int AS n FROM broadcasts WHERE org_id = ${orgId} AND NOT archived`,
      ),
  },
  {
    key: 'segments',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM segments WHERE org_id = ${orgId}`),
  },
  {
    // Custom fields only: the system fields every workspace is born with are not the customer's to be capped.
    key: 'custom_fields',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM fields WHERE org_id = ${orgId} AND NOT is_system`),
  },
  {
    // Direct messages are rows of the same table but are not channels: they are neither capped nor counted.
    key: 'team_chat_channels',
    window: 'total',
    count: (tx, orgId) =>
      n(
        tx,
        sql`SELECT count(*)::int AS n FROM team_chat_channels WHERE org_id = ${orgId} AND type <> 'dm'`,
      ),
  },
  {
    key: 'sla_policies',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM sla_policies WHERE org_id = ${orgId}`),
  },
  {
    key: 'booking_types',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM booking_types WHERE org_id = ${orgId}`),
  },
  {
    key: 'chatbot_widgets',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM chatbot_widgets WHERE org_id = ${orgId}`),
  },
  {
    key: 'catalog_products',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM wa_products WHERE org_id = ${orgId}`),
  },
  {
    // Created this calendar month, every status: voiding or deleting an invoice does not give the month's allowance back.
    key: 'invoices_monthly',
    window: 'month',
    count: (tx, orgId, from, to) =>
      n(
        tx,
        sql`SELECT count(*)::int AS n FROM invoices
        WHERE org_id = ${orgId}
          AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz`,
      ),
  },
  {
    key: 'recurring_invoices',
    window: 'total',
    count: (tx, orgId) =>
      n(tx, sql`SELECT count(*)::int AS n FROM recurring_invoices WHERE org_id = ${orgId}`),
  },
  {
    // A revoked or expired key frees its place; only `active` ones count.
    key: 'api_keys',
    window: 'total',
    count: (tx, orgId) =>
      n(
        tx,
        sql`SELECT count(*)::int AS n FROM api_keys WHERE org_id = ${orgId} AND status = 'active'`,
      ),
  },
  {
    // The inbox's outbound webhooks and the API webhooks are one allowance to the customer.
    key: 'webhooks',
    window: 'total',
    count: (tx, orgId) =>
      n(
        tx,
        sql`SELECT ((SELECT count(*) FROM outbound_webhooks WHERE org_id = ${orgId})
                  + (SELECT count(*) FROM webhooks WHERE org_id = ${orgId}))::int AS n`,
      ),
  },
  {
    // Web forms the workspace has: every one that is not archived (an archived form frees its place). The Forms add-on.
    key: 'forms',
    window: 'total',
    count: (tx, orgId) =>
      n(
        tx,
        sql`SELECT count(*)::int AS n FROM web_forms WHERE org_id = ${orgId} AND status <> 'archived'`,
      ),
  },
  {
    // Accepted submissions this calendar month, spam excluded. The cap never blocks a submission (it is stored `needs_review`), so
    // this meter is the panel's number and the pipeline's own comparison.
    key: 'form_submissions_monthly',
    window: 'month',
    count: (tx, orgId, from, to) =>
      n(
        tx,
        sql`SELECT count(*)::int AS n FROM web_form_submissions
        WHERE org_id = ${orgId} AND status <> 'spam' AND NOT (status = 'needs_review' AND reason = 'submissions_cap')
          AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz`,
      ),
  },
  {
    // AI form builder generations this calendar month (counted from the builder's phase 2; the counter exists now).
    key: 'ai_form_generations_monthly',
    window: 'month',
    count: (tx, orgId, from) =>
      n(
        tx,
        sql`SELECT coalesce(sum(ai_generations), 0)::int AS n FROM web_form_usage_monthly
        WHERE org_id = ${orgId} AND period = ${from.toISOString().slice(0, 10)}::date`,
      ),
  },
  {
    // Mailboxes the workspace has connected: every one that is not disconnected (a disconnected one frees its place). The Email add-on.
    // Plain SQL on the table name: `mail_mailboxes` belongs to the channel-email module and is not imported here.
    key: 'email_mailboxes',
    window: 'total',
    count: (tx, orgId) =>
      n(
        tx,
        sql`SELECT count(*)::int AS n FROM mail_mailboxes WHERE org_id = ${orgId} AND status <> 'disconnected'`,
      ),
  },
  {
    // Tokens billed to the platform's keys this calendar month: the same sum AiTokenMeter.guard compares with the cap (it enforces; this row is the panel's number).
    key: 'ai_token_limit_monthly',
    window: 'month',
    count: (tx, orgId, from, to) =>
      n(
        tx,
        sql`SELECT coalesce(sum(total_tokens), 0)::bigint AS n FROM ai_token_usage
        WHERE org_id = ${orgId} AND billed_against = 'admin'
          AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz`,
      ),
  },
];

/** Keys whose enforcement is not "live row count < cap": see assertCanAdd. */
const NOT_A_ROW_COUNT: ReadonlySet<PlanLimitKey> = new Set<PlanLimitKey>([
  'monthly_messages',
  'sms_monthly',
  'total_campaigns',
  'broadcast_recipients',
  'ai_token_limit_monthly',
]);

async function n(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
  const res = await tx.execute(query);
  return Number((res.rows[0] as { n: number }).n);
}

export const meterPercent = (used: number, limit: number): number | null =>
  limit <= 0 ? null : Math.min(100, Math.floor((used / limit) * 100));

/**
 * The usage panel's numbers (TW-PLAN-014) and the downgrade check (TW-PLAN-006): "how much does this workspace hold
 * against each cap". Limits come from the resolver, so overrides and a lapsed plan's free fallback are respected.
 */
@Injectable()
export class PlanUsageService {
  constructor(
    private readonly db: DatabaseService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  /** Used counts for every metered key. */
  async counts(orgId: number, now = new Date()): Promise<Map<PlanLimitKey, number>> {
    const from = monthStart(now);
    const to = nextMonthStart(now);
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const out = new Map<PlanLimitKey, number>();
      for (const m of METERS) out.set(m.key, await m.count(tx, orgId, from, to));
      return out;
    });
  }

  /**
   * The one-line guard for a domain that creates a capped thing (devices, flows, templates, auto-replies, ...): counts what the workspace
   * holds with the SAME predicate the usage panel shows, then refuses row N+1 with 422 PLAN_LIMIT_REACHED. Call it before the insert, in the
   * creating request. Four keys are not live row counts and are refused here on purpose: `total_campaigns` is the delete-proof ledger
   * (PlanQuotaService), `monthly_messages` is an allowance whose overage bills the wallet instead of blocking, `broadcast_recipients` is
   * the size of one audience (assertAudienceWithin) and `ai_token_limit_monthly` is enforced by the AI token meter.
   */
  async assertCanAdd(orgId: number, key: PlanLimitKey, now = new Date()): Promise<void> {
    if (NOT_A_ROW_COUNT.has(key)) {
      throw new Error(`assertCanAdd does not apply to ${key}`);
    }
    const cap = await this.entitlements.limit(orgId, key);
    if (cap === 0) return; // unlimited: skip the count
    const meter = METERS.find((m) => m.key === key)!;
    const used = await this.db.txAs({ orgId, userId: null }, (tx) =>
      meter.count(tx, orgId, monthStart(now), nextMonthStart(now)),
    );
    await this.entitlements.assertWithinLimit(orgId, key, used);
  }

  /**
   * `broadcast_recipients`: the audience of ONE broadcast may not be bigger than the cap (0 = unlimited, override -1 = unlimited). Same 422
   * shape as the row caps; `used` is the audience size that was asked for.
   */
  async assertAudienceWithin(orgId: number, audience: number): Promise<void> {
    const cap = await this.entitlements.limit(orgId, 'broadcast_recipients');
    if (cap === 0 || audience <= cap) return;
    throw new AppError(
      ERROR_CODES.PLAN_LIMIT_REACHED,
      `Your plan allows up to ${cap} recipients in one broadcast, and this audience has ${audience}. Narrow the audience or upgrade your plan.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'limit', message: 'broadcast_recipients' },
        { path: 'reason', message: 'limit_reached' },
        { path: 'used', message: String(audience) },
        { path: 'limitValue', message: String(cap) },
        { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
      ],
    );
  }

  async meters(e: Entitlements, now = new Date()): Promise<UsageMeter[]> {
    const counts = await this.counts(e.orgId, now);
    return METERS.map((m) => {
      const used = counts.get(m.key) ?? 0;
      const limit = resolveLimit(e, m.key);
      return { key: m.key, used, limit, percent: meterPercent(used, limit), window: m.window };
    });
  }

  async usage(orgId: number, now = new Date()): Promise<BillingUsageResponse | null> {
    const e = await this.entitlements.forOrg(orgId);
    if (!e) return null;
    const meters = await this.meters(e, now);
    return {
      planSlug: e.planSlug,
      planName: e.planName,
      validity: validityForState(e.state, {
        trialEndsAt: e.trialEndsAt,
        planEndsAt: e.planEndsAt,
        autopay: e.autopay,
        graceDays: e.graceDays,
        now,
      }),
      meters,
      features: PLAN_FEATURE_KEYS.map((key) => ({ key, enabled: resolveFeature(e, key) })),
      cycleResetsAt: nextMonthStart(now).toISOString(),
    };
  }
}
