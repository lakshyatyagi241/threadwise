/** Public surface of the storefront-builder domain. Other domains import only from here. */
export { StorefrontBuilderModule } from './storefront-builder.module';
export { StorefrontBuilderWorkerModule } from './storefront-builder-worker.module';
/** `ensureDefaultShop(orgId, tx?)`: the channel domains call it when a workspace connects a number (WD-STORE-029). */
export { ShopsService } from './shops/shops.service';
/** `publicUrl(shop)` / `trackUrl(shop, token)`: the address buyers use (WD-STORE-022). */
export { ShopUrlService } from './shops/shop-url.service';
/** `mintLink(shop, order, callbackUrl)`: a Razorpay payment link with the shop's own keys (WD-STORE-018). */
export {
  StorefrontPaymentService,
  type PaymentOrderRef,
  type PaymentShopRef,
} from './payments/storefront-payment.service';
