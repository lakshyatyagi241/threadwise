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
  createStoreCouponSchema,
  listStoreCouponsQuerySchema,
  listStoreCouponUsagesQuerySchema,
  updateStoreCouponSchema,
  type CreateStoreCouponInput,
  type ListStoreCouponsQuery,
  type ListStoreCouponUsagesQuery,
  type UpdateStoreCouponInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../../plans-subscriptions-trials';
import { StoreCouponsService } from './store-coupons.service';

/** The merchant's discount codes (WaDesk /store/coupons). Behind the WhatsApp catalog plan feature (`wa_storefront`). */
@ApiTags('store-coupons')
@ActorKinds('user')
@RequirePlanFeature('wa_storefront')
@Controller({ path: 'store/coupons', version: '2' })
export class StoreCouponsController {
  constructor(private readonly coupons: StoreCouponsService) {}

  @Get()
  @RequirePermission('store.coupons.read')
  @ApiOperation({ summary: 'Discount codes, newest first; search by code, filter by state' })
  async list(@Query(zodPipe(listStoreCouponsQuerySchema)) query: ListStoreCouponsQuery) {
    return this.coupons.list(query);
  }

  @Get(':id')
  @RequirePermission('store.coupons.read')
  @ApiOperation({ summary: 'One discount code' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.coupons.get(id);
  }

  @Get(':id/usages')
  @RequirePermission('store.coupons.read')
  @ApiOperation({ summary: 'The orders that used the code, newest first' })
  async usages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listStoreCouponUsagesQuerySchema)) query: ListStoreCouponUsagesQuery,
  ) {
    return this.coupons.usages(id, query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('store.coupons.manage')
  @ApiOperation({
    summary: 'Create a discount code',
    description:
      'The code is stored upper case; 409 `STORE_COUPON_CODE_TAKEN` when a code equal ignoring case exists. A percentage is clamped to 100.',
  })
  async create(@Body(zodPipe(createStoreCouponSchema)) body: CreateStoreCouponInput) {
    return this.coupons.create(body);
  }

  @Put(':id')
  @Idempotent()
  @RequirePermission('store.coupons.manage')
  @ApiOperation({
    summary: 'Edit a discount code (the whole form, guarded by rowVersion)',
    description:
      '409 `ROW_VERSION_CONFLICT` for a stale form, 409 `STORE_COUPON_CODE_TAKEN` for a code another coupon holds.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateStoreCouponSchema)) body: UpdateStoreCouponInput,
  ) {
    return this.coupons.update(id, body);
  }

  @Post(':id/toggle')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('store.coupons.manage')
  @ApiOperation({ summary: 'Switch a discount code on or off' })
  async toggle(@Param('id', ParseUUIDPipe) id: string) {
    return this.coupons.toggle(id);
  }

  @Delete(':id')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('store.coupons.manage')
  @ApiOperation({ summary: 'Delete a discount code (orders that used it keep the code text)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.coupons.remove(id);
  }
}
