import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  applyCouponRequestSchema,
  paygwOrdersQuerySchema,
  paygwPlanSlugParamSchema,
  paygwQuoteQuerySchema,
  paygwWalletQuoteQuerySchema,
  placePlanOrderRequestSchema,
  placeWalletOrderRequestSchema,
  type ApplyCouponRequest,
  type PaygwOrdersQuery,
  type PaygwQuoteQuery,
  type PaygwWalletQuoteQuery,
  type PlacePlanOrderRequest,
  type PlaceWalletOrderRequest,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CheckoutService } from './checkout.service';
import { OrdersService } from './orders.service';

/** A workspace buying from the platform (TW-PAYGW-009, 011, 031, 035). */
@ApiTags('billing')
@ActorKinds('user')
@Controller({ path: 'billing', version: '2' })
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersService,
  ) {}

  @Get('checkout/wallet/quote')
  @RequirePermission('paygw.checkout.create')
  @ApiOperation({ summary: 'Price a wallet top-up and list the gateways that accept the currency' })
  quoteWallet(@Query(zodPipe(paygwWalletQuoteQuerySchema)) q: PaygwWalletQuoteQuery) {
    return this.checkout.quoteWallet(q);
  }

  @Post('checkout/wallet/orders')
  @Idempotent()
  @RequirePermission('paygw.checkout.create')
  @ApiOperation({ summary: 'Create a wallet top-up order and start the payment' })
  placeWallet(
    @Body(zodPipe(placeWalletOrderRequestSchema)) body: PlaceWalletOrderRequest,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.checkout.placeWalletOrder(body, key);
  }

  @Get('checkout/plans/:planSlug/quote')
  @RequirePermission('paygw.checkout.create')
  @ApiOperation({
    summary: 'Price a plan in a currency and period and list the gateways that accept it',
  })
  quotePlan(
    @Param('planSlug', zodPipe(paygwPlanSlugParamSchema)) planSlug: string,
    @Query(zodPipe(paygwQuoteQuerySchema)) q: PaygwQuoteQuery,
  ) {
    return this.checkout.quotePlan(planSlug, q);
  }

  @Post('checkout/plans/:planSlug/coupon')
  @RequirePermission('paygw.checkout.create')
  @ApiOperation({
    summary: 'Check a coupon against this plan (priced by the server) and return the order summary',
    description:
      'Advisory and throttled: nothing is reserved. The order re-checks the code against the same price.',
  })
  applyCoupon(
    @Param('planSlug', zodPipe(paygwPlanSlugParamSchema)) planSlug: string,
    @Body(zodPipe(applyCouponRequestSchema)) body: ApplyCouponRequest,
  ) {
    return this.checkout.applyCoupon(planSlug, body);
  }

  @Post('checkout/plans/:planSlug/orders')
  @Idempotent()
  @RequirePermission('paygw.checkout.create')
  @ApiOperation({ summary: 'Create a plan order and start the payment (redirect, widget or paid)' })
  placePlan(
    @Param('planSlug', zodPipe(paygwPlanSlugParamSchema)) planSlug: string,
    @Body(zodPipe(placePlanOrderRequestSchema)) body: PlacePlanOrderRequest,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.checkout.placePlanOrder(planSlug, body, key);
  }

  @Get('orders')
  @RequirePermission('paygw.orders.read')
  @ApiOperation({ summary: 'My purchases, newest first, with lifetime spend per currency' })
  listOrders(@Query(zodPipe(paygwOrdersQuerySchema)) q: PaygwOrdersQuery) {
    return this.orders.listMine(q);
  }
}
