import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createCouponRequestSchema,
  listCouponsQuerySchema,
  setCouponActiveRequestSchema,
  updateCouponRequestSchema,
  uuidSchema,
  type CreateCouponRequest,
  type ListCouponsQuery,
  type SetCouponActiveRequest,
  type UpdateCouponRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { CouponsService } from './coupons.service';

/** The operator's coupon catalogue (TW-CPN-001..005): every operator role reads, only super admins write. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/coupons', version: '2' })
export class PlatformCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @ApiOperation({ summary: 'Coupons newest first, with the KPI strip and the filter pill counts' })
  list(@Query(zodPipe(listCouponsQuerySchema)) q: ListCouponsQuery) {
    return this.coupons.list(q);
  }

  @Get('options')
  @ApiOperation({
    summary: 'Plans and add-ons a coupon can be limited to, currencies it can be locked to',
  })
  options() {
    return this.coupons.options();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One coupon' })
  get(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.coupons.get(id);
  }

  @Post()
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Create a coupon (the code is upper-cased and unique ignoring case)' })
  create(@Body(zodPipe(createCouponRequestSchema)) body: CreateCouponRequest) {
    return this.coupons.create(body);
  }

  @Patch(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Edit a coupon (needs the current rowVersion; an empty plan list means any plan)',
  })
  update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateCouponRequestSchema)) body: UpdateCouponRequest,
  ) {
    return this.coupons.update(id, body);
  }

  @Put(':id/active')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Switch a coupon on or off (a value, not a flip: repeating it changes nothing)',
  })
  setActive(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setCouponActiveRequestSchema)) body: SetCouponActiveRequest,
  ) {
    return this.coupons.setActive(id, body.value);
  }

  @Delete(':id')
  @OperatorRoles('super_admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a coupon (past orders keep their discount and code)' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.coupons.remove(id);
  }
}
