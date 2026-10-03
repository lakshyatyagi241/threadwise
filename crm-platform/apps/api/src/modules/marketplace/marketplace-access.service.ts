import { Injectable } from '@nestjs/common';
import { PLAN_UPGRADE_PATH, type MarketLock } from '@crm/contracts';
import { AddonEntitlementService, ModuleRegistryService } from '../addons-extension-registry';
import { lockOf } from './marketplace-rules';

/** The plan limit that caps how many apps a workspace has installed at once. */
export const INSTALLED_APPS_LIMIT = 'installed_apps';

/**
 * What a workspace may install: the plan feature an app is behind and the installable module that backs a first-party mini app. Both go
 * through the add-ons domain (the entitlement service counts the workspace's billing add-ons, so a paid add-on unlocks an app exactly as
 * it unlocks a plan feature, and the module registry says whether a module is switched on), so the Marketplace has no gate of its own.
 */
@Injectable()
export class MarketplaceAccess {
  constructor(
    private readonly entitlements: AddonEntitlementService,
    private readonly modules: ModuleRegistryService,
  ) {}

  /** A function that answers "is this app locked for the workspace" for the cards of one request, asking each question once. */
  async evaluator(
    orgId: number,
    installedCount: number,
  ): Promise<
    (app: {
      planFeature: string | null;
      moduleSlug: string | null;
      installed: boolean;
    }) => Promise<MarketLock | null>
  > {
    const cap = await this.entitlements.limit(orgId, INSTALLED_APPS_LIMIT);
    const features = new Map<string, boolean>();
    const mods = new Map<string, boolean>();
    return async (app) => {
      let planFeatureOn = true;
      if (app.planFeature) {
        if (!features.has(app.planFeature))
          features.set(
            app.planFeature,
            await this.entitlements.featureEnabled(orgId, app.planFeature),
          );
        planFeatureOn = features.get(app.planFeature)!;
      }
      let moduleOn = true;
      if (app.moduleSlug) {
        if (!mods.has(app.moduleSlug))
          mods.set(app.moduleSlug, await this.modules.isEnabled(app.moduleSlug));
        moduleOn = mods.get(app.moduleSlug)!;
      }
      return lockOf(
        {
          planFeature: app.planFeature,
          planFeatureOn,
          moduleSlug: app.moduleSlug,
          moduleOn,
          installed: app.installed,
          installedCount,
          cap,
        },
        PLAN_UPGRADE_PATH,
      );
    };
  }
}
