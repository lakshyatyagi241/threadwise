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
        now,
      }),
      meters,
      features: PLAN_FEATURE_KEYS.map((key) => ({ key, enabled: resolveFeature(e, key) })),
      cycleResetsAt: nextMonthStart(now).toISOString(),
    };
  }
}
