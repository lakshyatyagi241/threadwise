import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ENGINE_HANDSHAKE_PORT } from '../../infra/providers/addons-extension-registry/engine-handshake.port';
import { HttpEngineHandshakeAdapter } from '../../infra/providers/addons-extension-registry/http-engine-handshake.adapter';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { AddonEntitlementService } from './addon-entitlement.service';
import { AddonFulfilmentService } from './addon-fulfilment.service';
import { AddonPackService } from './addon-pack.service';
import { AddonsController } from './addons.controller';
import { EngineConnectionService } from './engine-connections.service';
import { ExtensionStore } from './extension-store';
import { ExtensionsService } from './extensions.service';
import { ModuleGateGuard } from './module-gate';
import { ModuleRegistryService } from './module-registry.service';
import { PlatformAddonsController } from './platform-addons.controller';
import { PlatformExtensionsController } from './platform-extensions.controller';
import { WorkspaceAddonsService } from './workspace-addons.service';

/**
 * Add-ons and the extension registry (domain ADD). Registered in app.module.ts. The auth module is global, so the
 * operator guard, the audit writer, the platform settings and the platform store are available here.
 *
 * Other domains use it through the barrel (index.ts): the module registry and its gate for installable modules,
 * the entitlement service for plan gates that must count add-ons, and the fulfilment service for checkout.
 */
@Module({
  imports: [PlansCoreModule],
  controllers: [PlatformExtensionsController, PlatformAddonsController, AddonsController],
  providers: [
    CryptoService,
    ExtensionStore,
    ModuleRegistryService,
    ModuleGateGuard,
    ExtensionsService,
    EngineConnectionService,
    { provide: ENGINE_HANDSHAKE_PORT, useClass: HttpEngineHandshakeAdapter },
    AddonPackService,
    AddonEntitlementService,
    AddonFulfilmentService,
    WorkspaceAddonsService,
  ],
  exports: [
    ModuleRegistryService,
    ModuleGateGuard,
    EngineConnectionService,
    AddonEntitlementService,
    AddonFulfilmentService,
  ],
})
export class AddonsExtensionRegistryModule {}
