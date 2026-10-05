import { Module } from '@nestjs/common';
import { PlanCatalogService } from './plan-catalog.service';
import { PlanEntitlementService } from './plan-entitlement.service';
import { PlanStore } from './plan-store';
import { PlanQuotaService } from './plan-quota.service';
import { PlanUsageService } from './plan-usage.service';

/**
 * The plan catalogue's read side and the entitlement resolver. No controllers
 * and no dependency on the auth module, so the auth module can import it
 * (through the barrel) without a cycle: the HTTP surface that needs auth's
 * guards lives in PlansModule, which depends on both.
 */
@Module({
  providers: [
    PlanStore,
    PlanCatalogService,
    PlanEntitlementService,
    PlanQuotaService,
    PlanUsageService,
  ],
  exports: [
    PlanStore,
    PlanCatalogService,
    PlanEntitlementService,
    PlanQuotaService,
    PlanUsageService,
  ],
})
export class PlansCoreModule {}
