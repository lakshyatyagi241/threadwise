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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { connectWoocommerceSchema, type ConnectWoocommerceInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { WoocommerceService } from './woocommerce.service';

/** Connecting a WooCommerce store (WD-ECOM-025, 026, 013). */
@ApiTags('woocommerce')
@ActorKinds('user')
@Controller({ path: 'woocommerce', version: '2' })
export class WoocommerceController {
  constructor(private readonly woo: WoocommerceService) {}

  @Get()
  @RequirePermission('ecom.read')
  @ApiOperation({
    summary:
      'Whether the integration is on, the webhook topics and the workspace’s store (never a key)',
  })
  overview() {
    return this.woo.overview();
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ecom.connect')
  @ApiOperation({
    summary: 'Check a store address and REST keys without saving anything',
    description: '200 `{ok, message}` either way: a failure is the answer, not an error.',
  })
  test(@Body(zodPipe(connectWoocommerceSchema)) body: ConnectWoocommerceInput) {
    return this.woo.test(body);
  }

  @Post('connect')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('ecom.connect')
  @ApiOperation({
    summary: 'Verify the keys against the live store, save the store and register its webhooks',
    description:
      '422 ECOM_DISABLED when the integration is off; ECOM_STORE_INVALID for a bad address; ECOM_STORE_UNREACHABLE when the store refuses the keys.',
  })
  connect(@Body(zodPipe(connectWoocommerceSchema)) body: ConnectWoocommerceInput) {
    return this.woo.connect(body);
  }

  @Delete('stores/:id')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('ecom.connect')
  @ApiOperation({
    summary:
      'Disconnect the store: its webhooks are removed and the row goes with its mapping and logs',
  })
  async disconnect(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.woo.disconnect(id);
  }

  @Post('stores/:id/sync')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ecom.connect')
  @ApiOperation({
    summary:
      'Sync now: read the store again, refresh its facts, queue the import and return its totals',
    description:
      '200 with `ok = false` and the reason when the store does not answer (it is then flagged `error`); 404 for another workspace’s store.',
  })
  sync(@Param('id', ParseUUIDPipe) id: string) {
    return this.woo.sync(id);
  }
}
