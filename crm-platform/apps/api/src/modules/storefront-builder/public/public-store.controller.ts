import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  abandonCartSchema,
  checkoutSchema,
  couponQuoteSchema,
  hostResolveQuerySchema,
  publicHomeQuerySchema,
  publicReviewInputSchema,
  type AbandonCartInput,
  type CheckoutInput,
  type CouponQuoteInput,
  type PublicHomeQuery,
  type PublicReviewInput,
} from '@crm/contracts';
import { Public } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { CartRecoveryService } from '../recovery/cart-recovery.service';
import { CheckoutService } from './checkout.service';
import { PublicCatalogService } from './public-catalog.service';
import { PublicLimit } from './public-rate-limit.guard';
import { PublicRateLimiter } from './public-rate-limiter';

/**
 * The public shop (TW-STORE-009..021). No sign-in, no session: the buyer is anonymous, the shop is named by its slug, every
 * price and quantity is re-derived on the server, and each route has its own per-address limit (checkout 20 a minute,
 * coupon 30, review 10, abandoned-cart beacon 30). Literal routes come before the `:slug` ones.
 */
@ApiTags('storefront-public')
@Controller({ path: 'store-public', version: '2' })
export class PublicStoreController {
  constructor(
    private readonly catalog: PublicCatalogService,
    private readonly checkout: CheckoutService,
    private readonly recovery: CartRecoveryService,
    private readonly limiter: PublicRateLimiter,
  ) {}

  @Public()
  @Get('host')
  @ApiOperation({
    summary: 'Which shop a host serves',
    description:
      'A verified custom domain, else `<slug>.<STOREFRONT_HOST>` in subdomain mode. 404 when the host serves no shop.',
  })
  async host(@Query(zodPipe(hostResolveQuerySchema)) query: { host: string }, @Ip() ip: string) {
    await this.limiter.hit('host', ip);
    return this.catalog.resolveHost(query.host);
  }

  @Public()
  @Get(':slug/home')
  @ApiOperation({
    summary: 'The shop home: shop block, 48 products per page, facets',
    description:
      '404 `STORE_NOT_AVAILABLE` for an unknown or disabled shop. Page 1 counts as a visit.',
  })
  async home(
    @Param('slug') slug: string,
    @Query(zodPipe(publicHomeQuerySchema)) query: PublicHomeQuery,
  ) {
    return this.catalog.home(slug, query);
  }

  @Public()
  @Get(':slug/products/:productSlug')
  @ApiOperation({ summary: 'A product page: product, related, approved reviews' })
  async product(@Param('slug') slug: string, @Param('productSlug') productSlug: string) {
    return this.catalog.product(slug, productSlug);
  }

  @Public()
  @Get(':slug/orders/:token')
  @ApiOperation({ summary: 'The tracking page of an order; the token is the only access control' })
  async order(@Param('slug') slug: string, @Param('token') token: string) {
    return this.catalog.order(slug, token);
  }

  @Public()
  @PublicLimit('checkout')
  @Post(':slug/checkout')
  @ApiOperation({
    summary: 'Place an order',
    description:
      'Ids and quantities only: prices come from the database. Optional `Idempotency-Key` header: a repeat returns the first order. 422 `STORE_ITEMS_UNAVAILABLE` when nothing is left to buy; an unknown coupon code is ignored. 20 a minute per address.',
  })
  async place(
    @Param('slug') slug: string,
    @Body(zodPipe(checkoutSchema)) body: CheckoutInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.checkout.checkout(slug, body, idempotencyKey?.trim() || undefined);
  }

  @Public()
  @PublicLimit('coupon')
  @Post(':slug/coupon')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Quote a coupon against the cart',
    description: '422 `STORE_COUPON_INVALID` for every reason alike. 30 a minute per address.',
  })
  async coupon(
    @Param('slug') slug: string,
    @Body(zodPipe(couponQuoteSchema)) body: CouponQuoteInput,
  ) {
    return this.checkout.quote(slug, body);
  }

  @Public()
  @PublicLimit('review')
  @Post(':slug/review')
  @ApiOperation({
    summary: 'Submit a product review (stored pending)',
    description:
      '422 "Unknown product." for a product of another workspace. 10 a minute per address.',
  })
  async review(
    @Param('slug') slug: string,
    @Body(zodPipe(publicReviewInputSchema)) body: PublicReviewInput,
  ) {
    return this.catalog.review(slug, body);
  }

  @Public()
  @PublicLimit('abandon')
  @Post(':slug/abandon')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Abandoned-cart beacon',
    description:
      '`scheduled` is false when recovery is off, the workspace has no sender, or an active recovery exists. 30 a minute per address.',
  })
  async abandon(
    @Param('slug') slug: string,
    @Body(zodPipe(abandonCartSchema)) body: AbandonCartInput,
  ) {
    return this.recovery.abandon(slug, body);
  }
}
