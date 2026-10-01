import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PlansResponse } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import { PLAN_COLUMNS, toFacts, type PlanRow } from './plan-row';
import {
  buildPlanCard,
  byCatalogueOrder,
  pickDefaultPlan,
  type PlanFacts,
  type ResolvedDefaultPlan,
} from './plan-rules';

/**
 * Read side of the plan catalogue (TW-PLAN-001/011): what exists, in what
 * order, and what a workspace sees. The catalogue is a platform table that
 * every transaction may read, so none of this needs a privileged connection.
 *
 * Writes (operator CRUD) are in PlanAdminService.
 */
@Injectable()
export class PlanCatalogService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Every plan (not add-ons), in catalogue order, inside the caller's transaction.
   * `plans.amount`, not `amount`: the column list aliases `amount::text AS amount`, and a bare
   * name in ORDER BY would sort by that text (so 100.00 would come before 9.00).
   */
  async listPlans(tx: Tx): Promise<PlanRow[]> {
    const res = await tx.execute(sql`
      SELECT ${PLAN_COLUMNS} FROM plans WHERE kind = 'plan'
      ORDER BY sort_order, plans.amount, slug
    `);
    return res.rows as unknown as PlanRow[];
  }

  async findBySlug(tx: Tx, slug: string): Promise<PlanRow | null> {
    const res = await tx.execute(sql`
      SELECT ${PLAN_COLUMNS} FROM plans WHERE kind = 'plan' AND slug = ${slug}
    `);
    return (res.rows[0] as unknown as PlanRow | undefined) ?? null;
  }

  /**
   * Whether an ACTIVE plan has this slug. A context-free read: the catalogue's
   * SELECT policy is open, so callers with no tenant (the operator console's
   * registration form) can ask without a privileged connection.
   */
  async isActiveSlug(slug: string): Promise<boolean> {
    const res = await this.db.primary.execute(sql`
      SELECT 1 FROM plans WHERE kind = 'plan' AND is_active AND slug = ${slug} LIMIT 1
    `);
    return res.rows.length > 0;
  }

  /**
   * Which plan a new organization gets (TW-PLAN-008): the registration
   * setting's plan, else the first active default, else the first active free
   * plan, else the literal 'starter'. See `pickDefaultPlan`.
   */
  async resolveDefaultPlan(
    tx: Tx,
    registrationDefaultSlug: string | null,
  ): Promise<ResolvedDefaultPlan> {
    const rows = await this.listPlans(tx);
    return pickDefaultPlan(rows.map(toFacts), registrationDefaultSlug);
  }

  /** Active plans as workspace cards, with the caller's current plan marked. */
  async cardsFor(orgId: number, currentSlug: string | null, trialEndsAt: Date | null) {
    const rows = await this.db.txAs({ orgId, userId: null }, (tx) => this.listPlans(tx));
    const plans = rows.map(toFacts);
    const current: PlanFacts | null = currentSlug
      ? (plans.find((p) => p.slug === currentSlug) ?? null)
      : null;
    const response: PlansResponse = {
      data: plans
        .filter((p) => p.isActive)
        .sort(byCatalogueOrder)
        .map((p) => buildPlanCard(p, currentSlug, current)),
      currentSlug,
      trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
    };
    return response;
  }
}
