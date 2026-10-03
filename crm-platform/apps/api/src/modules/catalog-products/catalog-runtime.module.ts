import { Module } from '@nestjs/common';
import { CATALOG_RUNTIME_SETTINGS } from '../../infra/providers/catalog-products/catalog-provider.port';
import { NodeBridgeRuntimeModule } from '../node-bridge-runtime';
import { CatalogSettingsService } from './catalog-settings.service';

/**
 * What the catalog adapters read at call time (the operator's Graph version, the Node bridge address). A module of its own so
 * the provider module in `infra` can take it as an import without importing the domain.
 */
@Module({
  imports: [NodeBridgeRuntimeModule],
  providers: [
    CatalogSettingsService,
    { provide: CATALOG_RUNTIME_SETTINGS, useExisting: CatalogSettingsService },
  ],
  exports: [CatalogSettingsService, CATALOG_RUNTIME_SETTINGS],
})
export class CatalogRuntimeModule {}
