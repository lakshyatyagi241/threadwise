import { Module } from '@nestjs/common';
import { readCatalogEnv } from '../../../config/domains/catalog-products.env';
import {
  BAILEYS_CATALOG_BRIDGE,
  CATALOG_PROVIDER,
  type BaileysCatalogBridge,
  type CatalogProvider,
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
 */
@Module({
  providers: [
    FixtureCatalogState,
    FixtureCatalogProvider,
    FixtureBaileysBridge,
    {
      provide: CATALOG_PROVIDER,
      inject: [FixtureCatalogProvider],
      useFactory: (fixture: FixtureCatalogProvider): CatalogProvider => {
        const env = readCatalogEnv();
        return env.CAT_PROVIDER_MODE === 'fixture'
          ? fixture
          : new MetaGraphCatalogProvider({ graphVersion: env.CAT_GRAPH_API_VERSION });
      },
    },
    {
      provide: BAILEYS_CATALOG_BRIDGE,
      inject: [FixtureBaileysBridge],
      useFactory: (fixture: FixtureBaileysBridge): BaileysCatalogBridge => {
        const env = readCatalogEnv();
        return env.CAT_PROVIDER_MODE === 'fixture'
          ? fixture
          : new HttpBaileysCatalogBridge({
              baseUrl: env.BAILEYS_SERVER_URL,
              token: env.BAILEYS_SERVER_TOKEN,
            });
      },
    },
  ],
  exports: [CATALOG_PROVIDER, BAILEYS_CATALOG_BRIDGE, FixtureCatalogState],
})
export class CatalogProvidersModule {}
