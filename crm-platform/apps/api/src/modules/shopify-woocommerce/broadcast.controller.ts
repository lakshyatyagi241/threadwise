import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  sendOfferSchema,
  sendWinbackSchema,
  type SendOfferInput,
  type SendWinbackInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { BroadcastService } from './broadcast.service';

/** Send an offer and the win-back broadcast of a store (TW-ECOM-014, 015), for both store types. */
@ApiTags('shopify', 'woocommerce')
@ActorKinds('user')
@Controller({ version: '2' })
export class BroadcastController {
  constructor(private readonly broadcasts: BroadcastService) {}

  @Post('shopify/stores/:id/offer')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ecom.broadcast')
  @ApiOperation({
    summary: 'Send one template to a contact group with a product and a coupon (Shopify)',
    description:
      '200 `{ok, total, queued}`; `ok: false` with a message for an unknown template or an empty audience. The sends run in the background.',
  })
  shopifyOffer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(sendOfferSchema)) body: SendOfferInput,
  ) {
    return this.broadcasts.offer('shopify', id, body);
  }

  @Post('woocommerce/stores/:id/offer')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ecom.broadcast')
  @ApiOperation({
    summary: 'Send one template to a contact group with a product and a coupon (WooCommerce)',
  })
  wooOffer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(sendOfferSchema)) body: SendOfferInput,
  ) {
    return this.broadcasts.offer('woocommerce', id, body);
  }

  @Post('shopify/stores/:id/winback')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ecom.broadcast')
  @ApiOperation({
    summary: 'Win-back: message customers by last order, order count and spend (Shopify)',
    description: 'Opted-out numbers are skipped. Same answer as the offer.',
  })
  shopifyWinback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(sendWinbackSchema)) body: SendWinbackInput,
  ) {
    return this.broadcasts.winback('shopify', id, body);
  }

  @Post('woocommerce/stores/:id/winback')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ecom.broadcast')
  @ApiOperation({
    summary: 'Win-back: message customers by last order, order count and spend (WooCommerce)',
  })
  wooWinback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(sendWinbackSchema)) body: SendWinbackInput,
  ) {
    return this.broadcasts.winback('woocommerce', id, body);
  }
}
