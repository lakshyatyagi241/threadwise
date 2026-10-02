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
import { connectShopifySchema, type ConnectShopifyInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { ShopifyService } from './shopify.service';

/** Connecting a Shopify store (TW-ECOM-004 to 007, 013). */
@ApiTags('shopify')
@ActorKinds('user')
@Controller({ path: 'shopify', version: '2' })
export class ShopifyController {
  constructor(private readonly shopify: ShopifyService) {}

  @Get()
  @RequirePermission('ecom.read')
  @ApiOperation({
    summary:
      'Whether the platform app is on, what it asks for, the webhook topics and the workspace’s store (never a token)',
  })
  overview() {
    return this.shopify.overview();
  }

  @Post('connect/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ecom.connect')
  @ApiOperation({
    summary:
      'The address the browser is sent to so the merchant can approve the app on their store',
    description:
      '422 ECOM_SHOP_INVALID for a domain that is not `*.myshopify.com`; 422 ECOM_NOT_CONFIGURED when the platform app is off or has no client id.',
  })
  start(@Body(zodPipe(connectShopifySchema)) body: ConnectShopifyInput) {
    return this.shopify.start(body);
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
    await this.shopify.disconnect(id);
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
    return this.shopify.sync(id);
  }
}
