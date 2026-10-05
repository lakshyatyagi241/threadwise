import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  PLAN_FEATURE_KEYS,
  type BillingUsageResponse,
  type PlanLimitKey,
  type UsageMeter,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import {
  PlanEntitlementService,
  resolveFeature,
  resolveLimit,
  type Entitlements,
} from './plan-entitlement.service';
import { monthStart, nextMonthStart, validityForState } from './plan-lifecycle';

/**
 * One count per capped key, in the order the usage panel lists them (WD-PLAN-014). Each count is the same one the
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
        WHERE org_id = ${orgId} AND direction = 'out'
          AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz`,
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
    // Campaigns created in this plan period, deleted ones included (the quota ledger, WD-PLAN-018): the number the create check reads.
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
];

async function n(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
  const res = await tx.execute(query);
  return Number((res.rows[0] as { n: number }).n);
}

export const meterPercent = (used: number, limit: number): number | null =>
  limit <= 0 ? null : Math.min(100, Math.floor((used / limit) * 100));

/**
 * The usage panel's numbers (WD-PLAN-014) and the downgrade check (WD-PLAN-006): "how much does this workspace hold
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
   * creating request. Two keys are not live counts and are refused here on purpose: `total_campaigns` is the delete-proof ledger
   * (PlanQuotaService) and `monthly_messages` is an allowance whose overage bills the wallet instead of blocking.
   */
  async assertCanAdd(orgId: number, key: PlanLimitKey, now = new Date()): Promise<void> {
    if (key === 'monthly_messages' || key === 'total_campaigns') {
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
