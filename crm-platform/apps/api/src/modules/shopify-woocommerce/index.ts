/** Public surface of the Shopify and WooCommerce integrations. Other domains import only from here. */
export { ShopifyWoocommerceModule } from './shopify-woocommerce.module';
export { ShopifyWoocommerceWorkerModule } from './shopify-woocommerce-worker.module';
export { EcomInboundService } from './ecom-inbound.service';
// Where the flow runtime hears that an order from a shop node was placed (TW-FLR-041).
export {
  EcomOrderHooks,
  flowRefOf,
  type EcomFlowOrder,
  type EcomOrderListener,
} from './order-hooks';
// What the flow runtime's shop node asks of the stores: stock, checkout links (TW-ECOM-036). The flow runtime binds it to its gate.
export { EcomFlowShop } from './ecom-flow-shop';
export { flowNoteOf } from './order-hooks';
