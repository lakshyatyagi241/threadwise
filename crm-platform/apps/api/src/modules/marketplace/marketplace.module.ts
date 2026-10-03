import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { MarketplaceConnectorsModule } from '../../infra/providers/marketplace';
import { AddonsExtensionRegistryModule } from '../addons-extension-registry';
import { RolesPermissionsModule } from '../roles-permissions';
import { BrowseRepository } from './browse.repository';
import { BrowseService } from './browse.service';
import { DeliveryService } from './delivery.service';
import { HookController } from './hook.controller';
import { HookThrottle } from './hook-throttle';
import { InstallationsRepository } from './installations.repository';
import { InstallationsService } from './installations.service';
import { LeadPipelineGateway } from './lead-pipeline.gateway';
import { MarketplaceAccess } from './marketplace-access.service';
import { MarketplaceController } from './marketplace.controller';
import { OperatorCatalogueService } from './operator-catalogue.service';
import { OperatorCatalogueStore } from './operator-catalogue.store';
import { OperatorInsightsService } from './operator-insights.service';
import { PlatformMarketplaceController } from './platform-marketplace.controller';
import { PullRunService } from './pull-run.service';
import { PullStateRepository } from './pull-state.repository';
import { RelayService } from './relay.service';
import { RequestsService } from './requests.service';

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
 * installable modules through the registry) and the lead pipeline through its two leaf ports (`LeadPipelineGateway`). The pull worker lives
 * in `MarketplaceWorkerModule` (the worker process only). Nothing here runs uploaded code: an app is data.
 */
@Module({
  imports: [AddonsExtensionRegistryModule, RolesPermissionsModule, MarketplaceConnectorsModule],
  controllers: [MarketplaceController, PlatformMarketplaceController, HookController],
  providers: [
    CryptoService,
    BrowseRepository,
    InstallationsRepository,
    PullStateRepository,
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
    PullRunService,
  ],
  exports: [
    PullRunService,
    DeliveryService,
    LeadPipelineGateway,
    InstallationsRepository,
    PullStateRepository,
  ],
})
export class MarketplaceModule {}
