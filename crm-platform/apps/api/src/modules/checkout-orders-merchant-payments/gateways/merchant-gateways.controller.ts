import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listStoreGatewaysQuerySchema,
  saveStoreGatewaySchema,
  storeGatewayScopeQuerySchema,
  type ListStoreGatewaysQuery,
  type SaveStoreGatewayInput,
  type StoreGatewayScopeQuery,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { MerchantGatewaysService } from './merchant-gateways.service';

/**
 * The shared workspace payment gateway, configured once in Settings (owner decision 2026-10-05). `storefrontId` on a call picks a
 * shop's override; without it the call is about the workspace default. Not plan-gated: Sales invoices read the same gateway.
 * Literal routes come before the `:slug` ones.
 */
@ApiTags('store-gateways')
@ActorKinds('user')
@Controller({ path: 'store/gateways', version: '2' })
export class MerchantGatewaysController {
  constructor(private readonly gateways: MerchantGatewaysService) {}

  @Get('drivers')
  @RequirePermission('store.gateways.read')
  @ApiOperation({
    summary:
      'The driver catalogue: every gateway, the fields it needs, and whether this build can charge with it',
  })
  async drivers() {
    return this.gateways.drivers();
  }

  @Get('resolved')
  @RequirePermission('store.gateways.read')
  @ApiOperation({
    summary:
      'The gateway a checkout (with storefrontId) or an invoice (without) would use now, and where it came from',
  })
  async resolved(@Query(zodPipe(storeGatewayScopeQuerySchema)) query: StoreGatewayScopeQuery) {
    return this.gateways.resolved(query.storefrontId);
  }

  @Get()
  @RequirePermission('store.gateways.read')
  @ApiOperation({
    summary:
      'Saved gateways (workspace default and shop overrides); credentials come back masked, never in clear',
  })
  async list(@Query(zodPipe(listStoreGatewaysQuerySchema)) query: ListStoreGatewaysQuery) {
    return this.gateways.list(query.storefrontId);
  }

  @Put(':slug')
  @Idempotent()
  @RequirePermission('store.gateways.manage')
  @ApiOperation({
    summary: 'Save a gateway: create or change it for the workspace or one shop',
    description:
      'A blank credential keeps the stored one; `clear` removes named fields; unknown field keys are 422. Secrets are encrypted at rest and never returned.',
  })
  async save(
    @Param('slug') slug: string,
    @Body(zodPipe(saveStoreGatewaySchema)) body: SaveStoreGatewayInput,
  ) {
    return this.gateways.save(slug, body);
  }

  @Post(':slug/test')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('store.gateways.manage')
  @ApiOperation({
    summary:
      'Check the saved keys. Razorpay and Stripe are verified with the provider; the others only for required fields.',
  })
  async test(
    @Param('slug') slug: string,
    @Query(zodPipe(storeGatewayScopeQuerySchema)) query: StoreGatewayScopeQuery,
  ) {
    return this.gateways.test(slug, query.storefrontId);
  }

  @Post(':slug/toggle')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('store.gateways.manage')
  @ApiOperation({ summary: 'Enable or disable a saved gateway' })
  async toggle(
    @Param('slug') slug: string,
    @Query(zodPipe(storeGatewayScopeQuerySchema)) query: StoreGatewayScopeQuery,
  ) {
    return this.gateways.toggle(slug, query.storefrontId);
  }

  @Post(':slug/default')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('store.gateways.manage')
  @ApiOperation({
    summary: 'Make a gateway the default of its scope',
    description:
      '422 `STORE_GATEWAY_NOT_CONFIGURED` when it is switched off or a required field is empty.',
  })
  async setDefault(
    @Param('slug') slug: string,
    @Query(zodPipe(storeGatewayScopeQuerySchema)) query: StoreGatewayScopeQuery,
  ) {
    return this.gateways.setDefault(slug, query.storefrontId);
  }

  @Delete(':slug')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('store.gateways.manage')
  @ApiOperation({ summary: 'Remove a saved gateway and its credentials' })
  async remove(
    @Param('slug') slug: string,
    @Query(zodPipe(storeGatewayScopeQuerySchema)) query: StoreGatewayScopeQuery,
  ): Promise<void> {
    await this.gateways.remove(slug, query.storefrontId);
  }
}
