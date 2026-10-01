import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';

export interface ContactQuota {
  /** 0 = unlimited. */
  limit: number;
  used: number;
  /** null = unlimited. */
  remaining: number | null;
}

/**
 * The plan's contact cap (TW-CON-026), enforced for EVERY writer: the API, the import, the
 * inbound capture. Reference checked it only on the UI add and at the start of an import, so a
 * workspace one under the cap could import any number of rows and the API never checked.
 *
 * `limit` is 0 when the plan has no cap or no plan row applies; platform-owned workspaces are
 * never limited (PlanEntitlementService decides all of that, this class only counts).
 */
@Injectable()
export class ContactQuotaService {
  constructor(private readonly entitlements: PlanEntitlementService) {}

  async usage(tx: Tx, orgId: number): Promise<ContactQuota> {
    const limit = await this.entitlements.limit(orgId, 'contacts');
    // Counting a big table is not free; an unlimited plan skips it.
    if (limit === 0) return { limit: 0, used: 0, remaining: null };
    const used = await this.count(tx, orgId);
    return { limit, used, remaining: Math.max(0, limit - used) };
  }

  /** Throws 422 PLAN_LIMIT_REACHED when one more contact would exceed the cap. */
  async assertCanAddOne(tx: Tx, orgId: number): Promise<void> {
    const limit = await this.entitlements.limit(orgId, 'contacts');
    if (limit === 0) return;
    await this.entitlements.assertWithinLimit(orgId, 'contacts', await this.count(tx, orgId));
  }

  private async count(tx: Tx, orgId: number): Promise<number> {
    const rows = await tx.execute(
      sql`SELECT count(*)::int AS n FROM contacts WHERE org_id = ${orgId}`,
    );
    return Number((rows.rows[0] as { n: number }).n);
  }
}
