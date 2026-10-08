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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createShopSchema,
  editShopSchema,
  resetStoreSchema,
  storeOverviewQuerySchema,
  updateStorefrontSchema,
  type CreateShopInput,
  type EditShopInput,
  type ResetStoreInput,
  type StoreOverviewQuery,
  type UpdateStorefrontInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { StoreOverviewService } from '../overview/store-overview.service';
import { StorefrontSettingsService } from './storefront-settings.service';
import { ShopsService } from './shops.service';
import { RequirePlanFeature } from '../../plans-subscriptions-trials';

/**
 * The merchant side of the storefront (WD-STORE-001..008): the dashboard, the shop wizard and the storefront settings.
 * Literal routes (`overview`, `shops/reset`) come before the `:id` ones.
 */
@ApiTags('storefront-builder')
@ActorKinds('user')
@Controller({ path: 'store', version: '2' })
export class StoreController {
  constructor(
    private readonly overview: StoreOverviewService,
    private readonly shops: ShopsService,
    private readonly settings: StorefrontSettingsService,
  ) {}

  @Get('overview')
  @RequirePermission('store.dashboard.read')
  @ApiOperation({
    summary: 'Store dashboard: 30-day KPIs, sales by day, best sellers, newest orders',
    description:
      '`shopId` picks the shop the page is about (default: the most recently updated). 404 `STORE_NO_SHOP` when the workspace has no shop yet.',
  })
  async getOverview(@Query(zodPipe(storeOverviewQuerySchema)) query: StoreOverviewQuery) {
    return this.overview.overview(query);
  }

  @Get('shops')
  @RequirePermission('store.storefront.read')
  @ApiOperation({ summary: 'The shop wizard: shops (newest first), connected devices, hasSender' })
  async wizard() {
    return this.shops.wizard();
  }

  // Plan feature on the admin write routes only; the public storefront (separate controller) keeps rendering and taking orders.
  @RequirePlanFeature('storefront_builder')
  @Post('shops')
  @Idempotent()
  @RequirePermission('store.shops.manage')
  @ApiOperation({
    summary: 'Create a shop',
    description:
      'The address is derived from the name (`-2`, `-3` when taken). 422 `STORE_NO_SENDER` without a connected WhatsApp number, 422 `STORE_DEVICE_INVALID` for a device that is not a connected one of this workspace.',
  })
  async create(@Body(zodPipe(createShopSchema)) body: CreateShopInput) {
    return this.shops.create(body);
  }

  @RequirePlanFeature('storefront_builder')
  @Post('shops/reset')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('store.shops.manage')
  @ApiOperation({
    summary: 'Clear every shop, order and product of the workspace',
    description:
      'Needs `{"confirm":"yes"}`, else 422 `STORE_RESET_NOT_CONFIRMED`. Products are deleted permanently.',
  })
  async reset(@Body(zodPipe(resetStoreSchema)) body: ResetStoreInput) {
    return this.shops.reset(body);
  }

  @Get('shops/:id')
  @RequirePermission('store.storefront.read')
  @ApiOperation({ summary: 'One shop with its settings' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.shops.get(id);
  }

  @RequirePlanFeature('storefront_builder')
  @Put('shops/:id')
  @Idempotent()
  @RequirePermission('store.shops.manage')
  @ApiOperation({
    summary: 'Wizard edit: name, custom domain, sending device',
    description:
      'The address never changes. Changing the domain resets it to unverified. A wizard save re-enables the shop (a WaDesk quirk, kept).',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(editShopSchema)) body: EditShopInput,
  ) {
    return this.shops.update(id, body);
  }

  @RequirePlanFeature('storefront_builder')
  @Put('shops/:id/settings')
  @Idempotent()
  @RequirePermission('store.storefront.manage')
  @ApiOperation({
    summary:
      'Storefront design page: theme, address, brand, shipping, payment, cart recovery, live switch',
    description:
      'Send the `rowVersion` you read (409 `ROW_VERSION_CONFLICT` otherwise). 409 `STORE_SLUG_TAKEN` for an address another shop owns. A blank Razorpay secret keeps the stored one; a provider other than `razorpay_api` drops the keys. Secrets are never returned.',
  })
  async updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateStorefrontSchema)) body: UpdateStorefrontInput,
  ) {
    return this.settings.update(id, body);
  }

  @RequirePlanFeature('storefront_builder')
  @Post('shops/:id/verify-domain')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('store.storefront.manage')
  @ApiOperation({
    summary: "Check the shop's custom domain CNAME",
    description:
      'The result is stored every time. 422 `STORE_DOMAIN_NOT_SET` when the shop has no custom domain.',
  })
  async verifyDomain(@Param('id', ParseUUIDPipe) id: string) {
    return this.settings.verifyDomain(id);
  }

  @RequirePlanFeature('storefront_builder')
  @Delete('shops/:id')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('store.shops.manage')
  @ApiOperation({ summary: 'Delete a shop and its orders; products stay' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.shops.remove(id);
  }
}
