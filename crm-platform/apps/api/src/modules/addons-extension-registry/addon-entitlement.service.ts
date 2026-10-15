import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AddonGrants } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import {
  PlanEntitlementService,
  grantedByPack,
  type WithheldAppFeature,
} from '../plans-subscriptions-trials';
import { addonLiveSql, readGrants } from './addon-grants';
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
    const live = sql.raw(addonLiveSql(await this.plans.graceDays()));
    const res = await this.db.txAs({ orgId, userId: null }, (tx) =>
      tx.execute(sql`
        SELECT p.features, p.limits, ma.slug AS app_slug,
               (SELECT wi.status FROM workspace_app_installations wi
                 WHERE wi.org_id = a.org_id AND wi.app_id = p.marketplace_app_id) AS install
        FROM workspace_addons a JOIN plans p ON p.id = a.package_id
        LEFT JOIN marketplace_apps ma ON ma.id = p.marketplace_app_id
        WHERE a.org_id = ${orgId} AND ${live}
      `),
    );
    return (
      res.rows as unknown as Array<{
        features: unknown;
        limits: unknown;
        app_slug: string | null;
        install: 'active' | 'disabled' | 'killed' | null;
      }>
    ).map((r) => {
      // The add-on that sells a Marketplace app grants the app's plan features only while the app is installed and running in the
      // workspace (the same rule the plan domain applies to the entitlements the web reads); any other add-on grants as stored.
      const features =
        r.app_slug === null
          ? r.features
          : Object.fromEntries(
              grantedByPack({ slug: r.app_slug, features: r.features, install: r.install }).map(
                (k) => [k, true],
              ),
            );
      return readGrants(features, r.limits);
    });
  }

  /** Plan features a subscribed app would grant but does not (not installed, or paused): why a gate is closed, for the Roles editor. */
  async withheldByApps(orgId: number): Promise<Record<string, WithheldAppFeature>> {
    return (await this.plans.forOrg(orgId))?.appWithheld ?? {};
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
