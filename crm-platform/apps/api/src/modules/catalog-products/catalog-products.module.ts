import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CatalogProvidersModule } from '../../infra/providers/catalog-products/catalog-providers.module';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { NoopConversationMirror } from './_shims/noop-conversation-mirror';
import { SqlAudienceDirectory } from './_shims/sql-audience-directory';
import { SqlSenderDirectory } from './_shims/sql-sender-directory';
import { SqlShopDirectory } from './_shims/sql-shop-directory';
import {
  AUDIENCE_DIRECTORY,
  CONVERSATION_MIRROR,
  SENDER_DIRECTORY,
  SHOP_DIRECTORY,
} from './_shims/tokens';
import { CatalogBindings } from './catalog-bindings';
import { CatalogConciergeService } from './catalog-concierge.service';
import { CatalogConnectionService } from './catalog-connection.service';
import { CatalogOrderAckService } from './catalog-order-ack.service';
import { CatalogOverviewService } from './catalog-overview.service';
import { CatalogPlan, WaStorefrontGuard } from './catalog-plan';
import { CatalogSendService } from './catalog-send.service';
import { CatalogSendsRepository } from './catalog-sends.repository';
import { CatalogSyncRepository } from './catalog-sync.repository';
import { CatalogSyncService } from './catalog-sync.service';
import { CatalogController, CollectionsController } from './catalog.controller';
import { CatalogsRepository } from './catalogs.repository';
import { CollectionsService } from './collections.service';
import { InventoryService } from './inventory.service';
import { ProductsController, ReviewsController } from './products.controller';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';
import { ReviewsService } from './reviews.service';
import { SqlStorefrontProductsReader } from './sql-storefront-reader';
import { StorefrontProductsReader } from './storefront-reader';

/**
 * WhatsApp commerce catalog, products, collections and review moderation (CAT).
 *
 * The shims under `_shims/` stand in for services other domains own (see `_shims/README.md`): each is replaced by binding the
 * real service to the same token. The Meta Graph and Node bridge calls sit behind the ports in `infra/providers/catalog-products`.
 * The product reader is the one door the storefront-builder domain uses into products and reviews.
 */
@Module({
  imports: [PlansCoreModule, CatalogProvidersModule],
  controllers: [CatalogController, CollectionsController, ProductsController, ReviewsController],
  providers: [
    CryptoService,
    CatalogPlan,
    WaStorefrontGuard,
    CatalogBindings,
    CatalogsRepository,
    CatalogSyncRepository,
    CatalogSendsRepository,
    ProductsRepository,
    ProductsService,
    ReviewsService,
    CollectionsService,
    CatalogOverviewService,
    CatalogConnectionService,
    CatalogSyncService,
    CatalogSendService,
    InventoryService,
    CatalogConciergeService,
    CatalogOrderAckService,
    { provide: StorefrontProductsReader, useClass: SqlStorefrontProductsReader },
    { provide: SENDER_DIRECTORY, useClass: SqlSenderDirectory },
    { provide: AUDIENCE_DIRECTORY, useClass: SqlAudienceDirectory },
    { provide: SHOP_DIRECTORY, useClass: SqlShopDirectory },
    { provide: CONVERSATION_MIRROR, useClass: NoopConversationMirror },
  ],
  exports: [
    StorefrontProductsReader,
    InventoryService,
    CatalogConciergeService,
    CatalogOrderAckService,
    CatalogSyncService,
  ],
})
export class CatalogProductsModule {}
