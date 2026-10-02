import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { setBillingModeSchema, type SetBillingModeInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { BillingModeService } from './billing-mode.service';

/** The workspace's own choice of who bills it for messages (TW-BSP-011). */
@ApiTags('bsp')
@ActorKinds('user')
@Controller({ path: 'bsp/billing-mode', version: '2' })
export class BillingModeController {
  constructor(private readonly mode: BillingModeService) {}

  @Get()
  @RequirePermission('bsp.billing.read')
  @ApiOperation({
    summary:
      'Current billing mode, whether reseller billing is available, and each number credit line',
  })
  async get() {
    return this.mode.get();
  }

  @Put()
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('bsp.billing.manage')
  @ApiOperation({
    summary: 'Choose meta_direct or reseller',
    description:
      'reseller flips the workspace to wallet billing and attaches the platform credit line to each connected number; the response says how each attach went. meta_direct only flips the flag.',
  })
  async set(@Body(zodPipe(setBillingModeSchema)) body: SetBillingModeInput) {
    return this.mode.set(body.mode);
  }
}
