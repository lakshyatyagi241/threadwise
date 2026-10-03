import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PAYGW_PROOF_MAX_BYTES,
  paygwConfirmRequestSchema,
  paygwOrdersQuerySchema,
  paygwProofFieldsSchema,
  uuidSchema,
  paygwPlanSlugParamSchema,
  paygwQuoteQuerySchema,
  paygwWalletQuoteQuerySchema,
  placePlanOrderRequestSchema,
  placeWalletOrderRequestSchema,
  type PaygwConfirmRequest,
  type PaygwOrdersQuery,
  type PaygwProofFields,
  type PaygwQuoteQuery,
  type PaygwWalletQuoteQuery,
  type PlacePlanOrderRequest,
  type PlaceWalletOrderRequest,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { BuyerInvoiceService } from './buyer-invoice.service';
import { CheckoutService } from './checkout.service';
import { OrdersService } from './orders.service';
import { ProofService } from './proof.service';

/** A workspace buying from the platform (WD-PAYGW-009, 011, 031, 035). */
@ApiTags('billing')
@ActorKinds('user')
@Controller({ path: 'billing', version: '2' })
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersService,
    private readonly proofs: ProofService,
    private readonly invoices: BuyerInvoiceService,
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

  @Post('orders/:id/proof')
  @RequirePermission('paygw.checkout.create')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('proof', { limits: { fileSize: PAYGW_PROOF_MAX_BYTES + 1, files: 1 } }),
  )
  @ApiOperation({
    summary:
      'Attach proof of an offline payment (JPG, PNG, WEBP or PDF up to 4 MB) to a pending order',
  })
  submitProof(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body(zodPipe(paygwProofFieldsSchema)) body: PaygwProofFields,
  ) {
    return this.proofs.submit(id, file?.buffer, body);
  }

  @Post('orders/:id/confirm')
  @HttpCode(200)
  @RequirePermission('paygw.checkout.create')
  @ApiOperation({
    summary:
      'An in-app client confirms its own order with what the provider returned (verified server side)',
  })
  confirm(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(paygwConfirmRequestSchema)) body: PaygwConfirmRequest,
  ) {
    return this.orders.confirmMine(id, body);
  }

  @Get('orders/:id/invoice')
  @RequirePermission('paygw.orders.read')
  @ApiOperation({ summary: 'The invoice of one of my orders, ready to print' })
  invoice(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.invoices.view(id);
  }
}
