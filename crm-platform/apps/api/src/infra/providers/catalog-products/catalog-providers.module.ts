import { Module, type DynamicModule, type ModuleMetadata } from '@nestjs/common';
import { readCatalogEnv } from '../../../config/domains/catalog-products.env';
import {
  BAILEYS_CATALOG_BRIDGE,
  CATALOG_PROVIDER,
  CATALOG_RUNTIME_SETTINGS,
  type BaileysCatalogBridge,
  type CatalogProvider,
  type CatalogRuntimeSettings,
} from './catalog-provider.port';
import {
  FixtureBaileysBridge,
  FixtureCatalogProvider,
  FixtureCatalogState,
} from './fixture.catalog.provider';
import { HttpBaileysCatalogBridge } from './http-baileys.catalog-bridge';
import { MetaGraphCatalogProvider } from './meta-graph.catalog.provider';

/**
 * Binds the catalog ports: the live adapters by default, the in-memory sandbox when `CAT_PROVIDER_MODE=fixture`. The mode is
 * read once at boot. `FixtureCatalogState` is exported so a test can seed Meta and read back what was sent.
 *
 * The live adapters ask `CATALOG_RUNTIME_SETTINGS` (the operator's Graph version and Node bridge address) on every call. infra
 * cannot import a domain module, so the catalog module hands in the module that provides that token: `register({ runtime })`.
 */
@Module({})
export class CatalogProvidersModule {
  static register(runtime: { imports: NonNullable<ModuleMetadata['imports']> }): DynamicModule {
    return {
      module: CatalogProvidersModule,
      imports: runtime.imports,
      providers: [
        FixtureCatalogState,
        FixtureCatalogProvider,
        FixtureBaileysBridge,
        {
          provide: CATALOG_PROVIDER,
          inject: [FixtureCatalogProvider, CATALOG_RUNTIME_SETTINGS],
          useFactory: (
            fixture: FixtureCatalogProvider,
            settings: CatalogRuntimeSettings,
          ): CatalogProvider =>
            readCatalogEnv().CAT_PROVIDER_MODE === 'fixture'
              ? fixture
              : new MetaGraphCatalogProvider({ graphVersion: () => settings.graphVersion() }),
        },
        {
          provide: BAILEYS_CATALOG_BRIDGE,
          inject: [FixtureBaileysBridge, CATALOG_RUNTIME_SETTINGS],
          useFactory: (
            fixture: FixtureBaileysBridge,
            settings: CatalogRuntimeSettings,
          ): BaileysCatalogBridge =>
            readCatalogEnv().CAT_PROVIDER_MODE === 'fixture'
              ? fixture
              : new HttpBaileysCatalogBridge({ target: () => settings.bridgeTarget() }),
        },
      ],
      exports: [CATALOG_PROVIDER, BAILEYS_CATALOG_BRIDGE, FixtureCatalogState],
    };
  }
}
