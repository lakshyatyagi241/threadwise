/**
 * Public surface of the plans domain (WD-PLAN, thin slice for AUTH).
 *
 * The barrel exports the read/entitlement side only (PlansCoreModule and its
 * services, plus the pure rules): the auth module imports these. PlansModule,
 * which carries the controllers and depends on the auth barrel, is registered
 * directly by app.module.ts; exporting it here would make the two barrels
 * import each other.
 */
export { PlansCoreModule } from './plans-core.module';
export { PlanCatalogService } from './plan-catalog.service';
export { PlanQuotaService } from './plan-quota.service';
export { PlanUsageService } from './plan-usage.service';
export {
  PlanEntitlementService,
  resolveFeature,
  resolveLimit,
  appVisibleOnPlan,
  featureLocked,
  type Entitlements,
  type VisibleApps,
  type InitialPlan,
} from './plan-entitlement.service';
export {
  FALLBACK_PLAN_SLUG,
  buildPlanCard,
  classifyPlanAction,
  pickChips,
  pickDefaultPlan,
  planKind,
  slugifyPlanName,
  trialFor,
  uniquePlanSlug,
  type PlanFacts,
  type ResolvedDefaultPlan,
  type TrialStamp,
} from './plan-rules';
export {
  grantedByPack,
  splitAppPacks,
  type AppPack,
  type InstallStatus,
  type WithheldAppFeature,
} from './app-grants';
export { PlansWorkerModule } from './plans-worker.module';
export { PlanRetentionService } from './plan-retention.service';
export {
  RequirePlanFeature,
  REQUIRE_PLAN_FEATURE_KEY,
  planFeatureLabel,
} from './plan-feature.guard';
export { validityForState, fallsBackToFree } from './plan-lifecycle';
