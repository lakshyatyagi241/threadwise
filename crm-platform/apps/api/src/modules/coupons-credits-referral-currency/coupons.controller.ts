import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  couponListQuerySchema,
  createCouponRequestSchema,
  setCouponActiveRequestSchema,
  updateCouponRequestSchema,
  uuidSchema,
  type CouponListQuery,
  type CreateCouponPayload,
  type SetCouponActiveRequest,
  type UpdateCouponPayload,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { CouponAdminService } from './coupon-admin.service';

/**
 * The discount-coupon catalogue for platform operators (TW-CPN-001..005). Every operator role reads; only super admins write
 * (the guard's role list), and every write is recorded in security_events.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform', version: '2' })
export class CouponsController {
  constructor(private readonly coupons: CouponAdminService) {}

  @Get('coupons')
  @ApiOperation({
    summary: 'Coupons, newest first, 12 per page, with the KPI strip and the pill counts',
  })
  list(@Query(zodPipe(couponListQuerySchema)) query: CouponListQuery) {
    return this.coupons.list(query);
  }

  @Get('billing-options')
  @ApiOperation({ summary: 'The plans and currencies the coupon and credit-package forms offer' })
  options() {
    return this.coupons.options();
  }

  @Get('coupons/:id')
  @ApiOperation({ summary: 'One coupon' })
  one(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.coupons.get(id);
  }

  @Post('coupons')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Create a coupon (the code is upper-cased and unique)' })
  create(@Body(zodPipe(createCouponRequestSchema)) body: CreateCouponPayload) {
    return this.coupons.create(body);
  }

  @Patch('coupons/:id')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Update a coupon (partial, optimistic-locked; an empty plan list clears the restriction)',
  })
  update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateCouponRequestSchema)) body: UpdateCouponPayload,
  ) {
    return this.coupons.update(id, body);
  }

  @Patch('coupons/:id/active')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Enable or disable a coupon (stops new redemptions, keeps history)' })
  setActive(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setCouponActiveRequestSchema)) body: SetCouponActiveRequest,
  ) {
    return this.coupons.setActive(id, body.isActive, body.rowVersion);
  }

  @Delete('coupons/:id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Delete a coupon; past orders keep their discount and code snapshot' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.coupons.remove(id);
    return { ok: true as const };
  }
}
