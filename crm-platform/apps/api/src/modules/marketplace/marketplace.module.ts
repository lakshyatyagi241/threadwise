import { Module, type OnModuleInit } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { MarketplaceConnectorsModule } from '../../infra/providers/marketplace';
import { AddonFulfilmentHooks, AddonsExtensionRegistryModule } from '../addons-extension-registry';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformPaymentGatewaysModule } from '../platform-payment-gateways';
import { RolesPermissionsModule } from '../roles-permissions';
import { BrowseRepository } from './browse.repository';
import { BrowseService } from './browse.service';
import { DeliveryService } from './delivery.service';
import { HookController } from './hook.controller';
import { HookThrottle } from './hook-throttle';
import { InboundEventsRepository } from './inbound-events.repository';
import { InboundIntake } from './inbound-intake.service';
import { InboundRunService } from './inbound-run.service';
import { InstallationsRepository } from './installations.repository';
import { InstallationsService } from './installations.service';
import { LeadPipelineGateway } from './lead-pipeline.gateway';
import { MarketplaceAccess } from './marketplace-access.service';
import { MarketplaceController } from './marketplace.controller';
import { OperatorCatalogueService } from './operator-catalogue.service';
import { OperatorCatalogueStore } from './operator-catalogue.store';
import { OperatorInsightsService } from './operator-insights.service';
import { OperatorPricingService } from './operator-pricing.service';
import { PricingAccess } from './pricing-access.service';
import { PlatformMarketplaceController } from './platform-marketplace.controller';
import { MarketplaceLeadPullBinding, MarketplaceLeadPullProvider } from './lead-pull.provider';
import { PullBackfillService } from './pull-backfill.service';
import { PullRunService } from './pull-run.service';
import { PullSyncService } from './pull-sync.service';
import { PullStateRepository } from './pull-state.repository';
import { RelayService } from './relay.service';
import { RequestsService } from './requests.service';
import { MarketSubscriptionLifecycle } from './subscription-lifecycle.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * The Marketplace (domain `market`, code MKT): the catalogue of mini apps and integrations, per-workspace installation with permission
 * consent, the connector framework, requests, and the operator API. Registered in app.module.ts. The auth module is global, so the
 * operator guard, the audit writer and the platform store are available here.
 *
 *   /v2/marketplace                  a workspace browses, installs and manages (plan feature `marketplace`, `market.apps.*`)
 *   /v2/platform/marketplace         the operator runs the catalogue (`platform.market.manage` and `.review`)
 *   /v2/public/marketplace/hooks/:k  the delivery address of a push or webhook-relay connection (no session; the secret authenticates)
 *
 * It reuses the add-ons domain for what a workspace may install (plan feature and billing add-ons through the entitlement service,
 * installable modules through the registry) and the lead pipeline through its two leaf ports (`LeadPipelineGateway`). A paid app is sold
 * as a billing add-on through the existing checkout (`PricingAccess`, `SubscriptionsService`, `MarketSubscriptionLifecycle`): there is no
 * second billing system. The pull worker lives
 * in `MarketplaceWorkerModule` (the worker process only). Nothing here runs uploaded code: an app is data.
 */
@Module({
  imports: [
    AddonsExtensionRegistryModule,
    PlansCoreModule,
    // The card renewal of an app lives with the payment provider: cancelling a subscription asks the payments domain to end it there.
    PlatformPaymentGatewaysModule,
    RolesPermissionsModule,
    MarketplaceConnectorsModule,
  ],
  controllers: [MarketplaceController, PlatformMarketplaceController, HookController],
  providers: [
    CryptoService,
    BrowseRepository,
    InstallationsRepository,
    PullStateRepository,
    InboundEventsRepository,
    InboundIntake,
    OperatorCatalogueStore,
    MarketplaceAccess,
    LeadPipelineGateway,
    DeliveryService,
    HookThrottle,
    RelayService,
    BrowseService,
    InstallationsService,
    RequestsService,
    OperatorCatalogueService,
    OperatorInsightsService,
    PricingAccess,
    MarketSubscriptionLifecycle,
    SubscriptionsService,
    OperatorPricingService,
    PullRunService,
    PullSyncService,
    PullBackfillService,
    MarketplaceLeadPullProvider,
    MarketplaceLeadPullBinding,
    InboundRunService,
  ],
  exports: [
    MarketSubscriptionLifecycle,
    PullRunService,
    DeliveryService,
    LeadPipelineGateway,
    InstallationsRepository,
    PullStateRepository,
    InboundEventsRepository,
    InboundIntake,
    InboundRunService,
  ],
})
export class MarketplaceModule implements OnModuleInit {
  constructor(
    private readonly hooks: AddonFulfilmentHooks,
    private readonly subscriptions: MarketSubscriptionLifecycle,
  ) {}

  /**
   * The add-ons domain tells a registered listener, in the purchase's own transaction, about every add-on that sells an app. Registered here
   * so the API process (checkout, the payment webhook) and the worker process (the subscription reconciler) both have it.
   */
  onModuleInit(): void {
    this.hooks.register(this.subscriptions);
  }
}
