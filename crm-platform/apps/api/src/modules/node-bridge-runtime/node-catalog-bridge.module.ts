import { Global, Module } from '@nestjs/common';
import { BAILEYS_CATALOG_BRIDGE_OVERRIDE } from '../../infra/providers/catalog-products/catalog-provider.port';
import { NodeBridgeRuntimeModule } from './node-bridge-runtime.module';
import { NodeCatalogBridge } from './outbound/catalog-bridge.adapter';

/**
 * Hands the catalog its sender for the unofficial engine (WD-NODE-024). The catalog binds `BAILEYS_CATALOG_BRIDGE` to whatever provides
 * `BAILEYS_CATALOG_BRIDGE_OVERRIDE` (the HTTP bridge when nothing does); this module provides the in-process one and is global so the
 * catalog sees it without importing the engine. Registered in the API and in the workers: the catalog sends from both.
 */
@Global()
@Module({
  imports: [NodeBridgeRuntimeModule],
  providers: [
    NodeCatalogBridge,
    { provide: BAILEYS_CATALOG_BRIDGE_OVERRIDE, useExisting: NodeCatalogBridge },
  ],
  exports: [BAILEYS_CATALOG_BRIDGE_OVERRIDE],
})
export class NodeCatalogBridgeModule {}
