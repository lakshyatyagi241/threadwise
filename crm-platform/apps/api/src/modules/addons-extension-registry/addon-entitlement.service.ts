import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AddonGrants } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { readGrants } from './addon-grants';
import { mergeFeature, mergeLimit, type PlanFacts } from './entitlement-merge';
import { ModuleRegistryService } from './module-registry.service';

/**
 * "May this workspace use feature X" and "what is its cap on Y" once its add-ons are counted (TW-ADD-031).
 *
 * It wraps the plan domain's resolver instead of changing it: the plan facts (plan, overrides, platform ownership)
 * come from PlanEntitlementService.forOrg, the add-ons from the workspace's own active purchases, and the pure
 * merge in entitlement-merge.ts decides. A gate that wants add-ons honoured asks THIS service.
 *
 * "Active" is evaluated at read time (status active and not past its end); there is no sweeper, and nothing is
 * cached across requests, so a purchase or an expiry is visible on the very next call.
 */
@Injectable()
export class AddonEntitlementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly plans: PlanEntitlementService,
    private readonly registry: ModuleRegistryService,
  ) {}

  /** The grants of every active, unexpired add-on the organization owns. Rows are per purchase, so packs stack. */
  async activeGrants(orgId: number): Promise<AddonGrants[]> {
    const res = await this.db.txAs({ orgId, userId: null }, (tx) =>
      tx.execute(sql`
        SELECT p.features, p.limits
        FROM workspace_addons a JOIN plans p ON p.id = a.package_id
        WHERE a.org_id = ${orgId} AND a.status = 'active' AND (a.ends_at IS NULL OR a.ends_at > now())
      `),
    );
    return (res.rows as unknown as Array<{ features: unknown; limits: unknown }>).map((r) =>
      readGrants(r.features, r.limits),
    );
  }

  private async facts(orgId: number): Promise<PlanFacts | null> {
    const e = await this.plans.forOrg(orgId);
    if (!e) return null;
    return {
      platformOwned: e.platformOwned,
      planKnown: e.planKnown,
      overrides: e.overrides,
      planFeatures: e.planFeatures,
      planLimits: e.planLimits,
    };
  }

  async featureEnabled(orgId: number, key: string): Promise<boolean> {
    const plan = await this.facts(orgId);
    if (!plan) return false; // no such organization: nothing is granted
    const dormant = await this.registry.isDormantFeature(key);
    const addons = plan.platformOwned || dormant ? [] : await this.activeGrants(orgId);
    return mergeFeature(plan, key, addons, { dormant });
  }

  /** The cap on `key`; 0 means unlimited (the plan domain's convention). */
  async limit(orgId: number, key: string): Promise<number> {
    const plan = await this.facts(orgId);
    if (!plan) return 0;
    const declared = (await this.registry.planLimits()).find((l) => l.key === key);
    const addons = plan.platformOwned ? [] : await this.activeGrants(orgId);
    return mergeLimit(plan, key, addons, declared?.default ?? null);
  }
}
