import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, PLAN_UPGRADE_PATH, type PlanLimitKey } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { PlanEntitlementService } from './plan-entitlement.service';

/**
 * The delete-proof quota ledger (WD-PLAN-018). For caps where "create 5, delete 5, create 5 again" must not beat the limit, creations
 * are counted in an increment-only ledger (`plan_usage`) keyed by metric and billing period, instead of counting live rows.
 *
 * The period key is the plan plus the plan's end date (WaDesk's rule, kept): buying, changing or renewing a plan moves it, which opens a
 * fresh allowance with no reset job. QUIRKS that come with that rule and are deliberately kept: an operator edit of the end date or a lapse
 * to the free plan moves the period too, and going back to the same plan with the same end date returns to the OLD counter.
 *
 * Usage, from the domain that creates the thing (inside its own transaction):
 *   await quota.assertAvailable(tx, orgId, 'total_campaigns', 'campaign', () => countAllCampaignsEverCreated);
 *   ...insert the campaign...
 *   await quota.bump(tx, orgId, 'campaign');
 * `bump` is the only writer; there is deliberately no way to decrement.
 */
@Injectable()
export class PlanQuotaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  /** `<plan slug>|<plan end as yyyymmdd, or 0>`: changes when the plan changes or the end date moves. */
  async period(tx: Tx, orgId: number): Promise<string> {
    const res = await tx.execute(sql`
      SELECT o.plan, to_char(s.plan_ends_at AT TIME ZONE 'UTC', 'YYYYMMDD') AS ends
      FROM organizations o LEFT JOIN org_plan_state s ON s.org_id = o.id WHERE o.id = ${orgId}`);
    const row = res.rows[0] as { plan: string; ends: string | null } | undefined;
    return `${row?.plan ?? '0'}|${row?.ends ?? '0'}`;
  }

  /** Creations counted in the current period (0 when there is no row yet). */
  async used(tx: Tx, orgId: number, metric: string): Promise<number> {
    const period = await this.period(tx, orgId);
    const res = await tx.execute(
      sql`SELECT count FROM plan_usage WHERE org_id = ${orgId} AND metric = ${metric} AND period = ${period}`,
    );
    return Number((res.rows[0] as { count: number } | undefined)?.count ?? 0);
  }

  /**
   * Throws 422 PLAN_LIMIT_REACHED (`reason: quota_reached`) when the period's allowance for `limitKey` is spent. The first time a workspace
   * ever meets a metric, the ledger adopts `liveCount()` as its starting value, so an install that predates the ledger starts at its true
   * usage. A later period legitimately starts at 0 (rows of older periods exist, so nothing is adopted again).
   */
  async assertAvailable(
    tx: Tx,
    orgId: number,
    limitKey: PlanLimitKey,
    metric: string,
    liveCount: () => Promise<number>,
  ): Promise<void> {
    const cap = await this.entitlements.limit(orgId, limitKey);
    if (cap === 0) return;
    const period = await this.period(tx, orgId);
    await this.seedIfFirstEver(tx, orgId, metric, period, liveCount);
    const res = await tx.execute(
      sql`SELECT count FROM plan_usage WHERE org_id = ${orgId} AND metric = ${metric} AND period = ${period}`,
    );
    const used = Number((res.rows[0] as { count: number } | undefined)?.count ?? 0);
    if (used < cap) return;
    throw new AppError(
      ERROR_CODES.PLAN_LIMIT_REACHED,
      `You've reached your plan's limit of ${cap} ${limitKey.replace(/_/g, ' ')}. Upgrade your plan to create more.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'limit', message: limitKey },
        { path: 'reason', message: 'quota_reached' },
        { path: 'used', message: String(used) },
        { path: 'limitValue', message: String(cap) },
        { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
      ],
    );
  }

  /** Atomic increment: one statement, so two creates at once cannot lose a count. A zero or negative quantity is ignored. */
  async bump(tx: Tx, orgId: number, metric: string, qty = 1): Promise<void> {
    if (!Number.isInteger(qty) || qty <= 0) return;
    const period = await this.period(tx, orgId);
    await tx.execute(sql`
      INSERT INTO plan_usage (org_id, metric, period, count) VALUES (${orgId}, ${metric}, ${period}, ${qty})
      ON CONFLICT (org_id, metric, period) DO UPDATE SET count = plan_usage.count + EXCLUDED.count`);
  }

  private async seedIfFirstEver(
    tx: Tx,
    orgId: number,
    metric: string,
    period: string,
    liveCount: () => Promise<number>,
  ): Promise<void> {
    const any = await tx.execute(
      sql`SELECT 1 FROM plan_usage WHERE org_id = ${orgId} AND metric = ${metric} LIMIT 1`,
    );
    if (any.rows.length > 0) return;
    const live = Math.max(0, Math.trunc(await liveCount()));
    await tx.execute(sql`
      INSERT INTO plan_usage (org_id, metric, period, count) VALUES (${orgId}, ${metric}, ${period}, ${live})
      ON CONFLICT (org_id, metric, period) DO NOTHING`);
  }
}
