import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  catalogActivityQuerySchema,
  catalogSendOptionsQuerySchema,
  commerceSettingsSchema,
  connectCatalogSchema,
  createCollectionSchema,
  saveAutomationSchema,
  sendCatalogSchema,
  syncProductsSchema,
  updateCollectionSchema,
  type CatalogActivityQuery,
  type CatalogSendOptionsQuery,
  type CommerceSettingsInput,
  type ConnectCatalogInput,
  type CreateCollectionInput,
  type SaveAutomationInput,
  type SendCatalogInput,
  type SyncProductsInput,
  type UpdateCollectionInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { WaStorefrontGuard } from './catalog-plan';
import { CatalogConnectionService } from './catalog-connection.service';
import { CatalogOverviewService } from './catalog-overview.service';
import { CatalogSendService } from './catalog-send.service';
import { CatalogSyncService } from './catalog-sync.service';
import { CollectionsService } from './collections.service';
import { RequestContextStore } from '../../common/context/request-context';

/**
 * The WhatsApp Catalog area (TW-CAT-001..018): Setup, Send, Collections and Activity. Every route needs the plan flag
 * `wa_storefront` (products and reviews do not, as in Reference) and the capability it names.
 *
 * Literal paths are declared before `:id` ones.
 */
@ApiTags('catalog')
@ActorKinds('user')
@UseGuards(WaStorefrontGuard)
@Controller({ path: 'catalog', version: '2' })
export class CatalogController {
  constructor(
    private readonly overview: CatalogOverviewService,
    private readonly connection: CatalogConnectionService,
    private readonly sync: CatalogSyncService,
    private readonly sender: CatalogSendService,
  ) {}

  // --- the tabs ------------------------------------------------------------------------------------------------------------

  @Get('overview')
  @RequirePermission('cat.catalog.read')
  @ApiOperation({
    summary: 'The Setup tab in one read',
    description:
      'The catalog (null when none is connected; the access token is never part of it), shops, sync counts by status, the 50 most recently changed products, the health score with up to 8 products to fix, the 5 latest sends and the connected senders.',
  })
  getOverview() {
    return this.overview.overview();
  }

  @Get('send-options')
  @RequirePermission('cat.catalog.read')
  @ApiOperation({
    summary: 'What the Send tab needs: senders, shops, contact groups, contacts, recent sends',
    description:
      'Contacts are the 500 newest (or the 500 newest matching `q`, a name or number search). `connected` is false when no sender exists and the tab shows "Connect a device first".',
  })
  sendOptions(@Query(zodPipe(catalogSendOptionsQuerySchema)) query: CatalogSendOptionsQuery) {
    return this.overview.sendOptions(query);
  }

  @Get('activity')
  @RequirePermission('cat.catalog.read')
  @ApiOperation({
    summary: 'The Activity tab: the latest catalog sends, newest first',
    description: 'One row per recipient attempt (sent and failed), 50 by default, up to 100.',
  })
  activity(@Query(zodPipe(catalogActivityQuerySchema)) query: CatalogActivityQuery) {
    return this.overview.activity(query);
  }

  // --- connection ----------------------------------------------------------------------------------------------------------

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('cat.catalog.manage')
  @ApiOperation({
    summary: 'Connect a Meta Cloud or 360dialog catalog',
    description:
      "The credentials are verified against Meta first and saved (encrypted) only when Meta accepts them: 422 CAT_META_REJECTED carries Meta's message, code and the catalog_management hint; 422 CAT_PROVIDER_FAILED when Meta could not be reached. Re-connecting a provider replaces its row and keeps the automation settings.",
  })
  connect(@Body(zodPipe(connectCatalogSchema)) body: ConnectCatalogInput) {
    return this.connection.connect(body);
  }

  @Post('autodetect')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('cat.catalog.manage')
  @ApiOperation({
    summary: 'Link the catalog from the connected WABA number',
    description:
      'Uses the stored WABA token: the catalog id of the WABA config, else the first catalog Meta lists for the WABA, else a new catalog created and linked (when a business id is known). 422 CAT_NO_WABA, CAT_WABA_TOKEN_MISSING, CAT_NO_CATALOG_LINKED, CAT_META_REJECTED.',
  })
  autodetect() {
    return this.connection.autodetect();
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Idempotent()
  @RequirePermission('cat.catalog.manage')
  @ApiOperation({
    summary: 'Disconnect the catalog',
    description:
      "Removes the binding and forgets every product's sync state (the retailer ids are kept). Nothing is removed from Meta. Succeeds when there is no catalog.",
  })
  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  @Post('commerce')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('cat.catalog.manage')
  @ApiOperation({
    summary: 'Show the catalog button and enable the cart (pushed to Meta, then stored)',
    description:
      "404 when no catalog; 422 CAT_NO_PHONE_NUMBER without a phone number id; 422 CAT_META_REJECTED with Meta's message (the stored flags are unchanged).",
  })
  commerce(@Body(zodPipe(commerceSettingsSchema)) body: CommerceSettingsInput) {
    return this.connection.setCommerce(body);
  }

  @Post('automation')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('cat.catalog.manage')
  @ApiOperation({
    summary: 'Save the order acknowledgement and concierge settings',
    description:
      'A missing flag is false, a blank text null. Keys without a control (concierge footer, acknowledgement template id) are kept. 404 when no catalog.',
  })
  automation(@Body(zodPipe(saveAutomationSchema)) body: SaveAutomationInput) {
    return this.connection.saveAutomation(body);
  }

  // --- sync ----------------------------------------------------------------------------------------------------------------

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('cat.catalog.manage')
  @ApiOperation({
    summary: 'Push one chunk (at most 1000) of active products to Meta',
    description:
      'With `productIds`: exactly those that are active. Without: the products never pushed or failed. Call again while `hasMore`. 422 CAT_NOT_CONNECTED; 502 when Meta refuses the batch (the chunk is marked failed).',
  })
  syncProducts(@Body(zodPipe(syncProductsSchema)) body: SyncProductsInput) {
    return this.sync.syncChunk(RequestContextStore.require().orgId, body.productIds);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('cat.catalog.manage')
  @ApiOperation({
    summary: 'Import the products of the Meta catalog',
    description:
      "Up to 2000 products. Existing rows (by retailer id) are updated, new ones created, all marked synced. A row without retailer id or name is skipped. 422 CAT_NOT_CONNECTED or Meta's own error.",
  })
  importFromMeta() {
    return this.sync.importFromMeta(RequestContextStore.require().orgId);
  }

  @Post('poll')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('cat.catalog.manage')
  @ApiOperation({
    summary: 'Refresh the status of the pending batches',
    description:
      "Pending products become synced or failed (with Meta's message); batches Meta still works on stay pending. 422 CAT_NOT_CONNECTED; 502 when Meta cannot be asked.",
  })
  poll() {
    return this.sync.pollWorkspace(RequestContextStore.require().orgId, true);
  }

  // --- send ----------------------------------------------------------------------------------------------------------------

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('cat.catalog.send')
  @ApiOperation({
    summary:
      'Send a catalog message (single product, product list or catalog link) to up to 500 numbers',
    description:
      'Recipients are pasted numbers, contacts and contact groups, de-duplicated. A workspace with a Meta catalog sends through Meta whatever the sender; without one, a carousel or the shop link goes through the connected device. The reply is 200 even when every recipient failed (`ok` is false then); rule failures are 422 CAT_NO_RECIPIENTS, CAT_TOO_MANY_RECIPIENTS, CAT_NO_PRODUCTS, CAT_NO_SENDER, CAT_NO_SHOP.',
  })
  send(@Body(zodPipe(sendCatalogSchema)) body: SendCatalogInput) {
    return this.sender.send(body);
  }
}

/** Collections: saved, ordered groups of up to 30 products (TW-CAT-017, 018). */
@ApiTags('catalog')
@ActorKinds('user')
@UseGuards(WaStorefrontGuard)
@Controller({ path: 'catalog/collections', version: '2' })
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  @RequirePermission('cat.catalog.read')
  @ApiOperation({
    summary: 'The collections with their products, plus the picker list',
    description: 'Newest first. `pickProducts` are the first 300 active products by name.',
  })
  list() {
    return this.collections.list();
  }

  @Post()
  @Idempotent()
  @RequirePermission('cat.collections.manage')
  @ApiOperation({
    summary: 'Create a collection',
    description:
      "1 to 30 product ids; ids that are not this workspace's are dropped and the submitted order is kept; none left is 422 CAT_COLLECTION_PRODUCTS_INVALID. The slug is made unique per workspace.",
  })
  create(@Body(zodPipe(createCollectionSchema)) body: CreateCollectionInput) {
    return this.collections.create(body);
  }

  @Put(':id')
  @Idempotent()
  @RequirePermission('cat.collections.manage')
  @ApiOperation({
    summary: 'Replace a collection',
    description:
      'The slug is regenerated only when the name changed. `rowVersion` is optional; when sent, a stale one is 409 ROW_VERSION_CONFLICT.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateCollectionSchema)) body: UpdateCollectionInput,
  ) {
    return this.collections.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Idempotent()
  @RequirePermission('cat.collections.manage')
  @ApiOperation({
    summary: 'Delete a collection',
    description: 'The products are untouched. Deleting one that is already gone succeeds.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.collections.remove(id);
  }
}
