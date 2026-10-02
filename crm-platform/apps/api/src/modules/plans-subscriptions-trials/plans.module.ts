import { Module } from '@nestjs/common';
import { PlatformPaymentGatewaysModule } from '../platform-payment-gateways';
import { PlanRetentionService } from './plan-retention.service';
import { SubscriptionService } from './subscription.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import {
  BillingFaqsController,
  PlatformPlanSettingsController,
  PlatformPricingFaqsController,
  PublicPricingFaqsController,
} from './pricing-faq.controllers';
import { PlanSettingsService } from './plan-settings.service';
import { PricingFaqService } from './pricing-faq.service';
import { PlanAdminService } from './plan-admin.service';
import { PlatformWorkspacePlansController } from './platform-workspace-plans.controller';
import { TrialGateGuard } from './trial-gate.guard';
import { WorkspacePlanAdminService } from './workspace-plan-admin.service';
import { PlanStore } from './plan-store';
import { PlansCoreModule } from './plans-core.module';
import { PlatformPlansController } from './platform-plans.controller';
import { PlansController } from './plans.controller';

/**
 * The plan HTTP surface: the workspace's plan list and the operator catalogue.
 * It imports the auth module (through its barrel) for the operator guard, the
 * gate-exempt marker and the audit writer; the auth module imports only
 * PlansCoreModule, so there is no cycle. Registered in app.module.ts.
 */
@Module({
  imports: [PlansCoreModule, PlatformPaymentGatewaysModule],
  controllers: [
    PlansController,
    PlatformPlansController,
    BillingController,
    PlatformWorkspacePlansController,
    PlatformPricingFaqsController,
    BillingFaqsController,
    PublicPricingFaqsController,
    PlatformPlanSettingsController,
  ],
  providers: [
    PlanAdminService,
    PlanStore,
    BillingService,
    WorkspacePlanAdminService,
    TrialGateGuard,
    PricingFaqService,
    PlanSettingsService,
    SubscriptionService,
    PlanRetentionService,
  ],
  // The trial gate is registered as an app-wide guard in app.module.ts: it must run after JwtAuthGuard has set the request context,
  // and guards declared by imported modules run before the app's own. Exported so app.module can reference this one instance.
  exports: [TrialGateGuard],
})
export class PlansModule {}
