/** Public surface of the catalog-products domain. Other domains import only from here. */
export { CatalogProductsModule } from './catalog-products.module';
export { CatalogProductsWorkerModule } from './catalog-products-worker.module';
export {
  StorefrontProductsReader,
  type StorefrontProduct,
  type StorefrontVariant,
  type StorefrontReview,
} from './storefront-reader';
// Stock ledger for flows and checkout (TW-CAT-025): hold, commit, release, by ref, and the expired-hold sweep.
export { InventoryService, type StockReservation } from './inventory.service';
// Inbound automations; the hook that calls them belongs to the inbox/webhook domain (TW-CAT-028, 029).
export { CatalogConciergeService } from './catalog-concierge.service';
export { CatalogOrderAckService, type CatalogOrderForAck } from './catalog-order-ack.service';
// A product written by another domain (importers, sheets) can ask for its push to Meta here (TW-CAT-012).
export { CatalogSyncService } from './catalog-sync.service';
// Pure rules other domains reuse: the retailer id, the effective availability, the order-text matcher, the Meta price.
export { retailerIdOf, effectiveAvailability } from './catalog-rules';
export { metaCatalogPrice, parseMetaPriceMinor } from './catalog-money';
export {
  matchProduct,
  matchVariant,
  type MatchResult,
  type VariantMatch,
  type MatchableVariant,
} from './product-matcher';
// Variants on the WhatsApp / Meta side: a variant's retailer id, the cart-line resolver, the id a product is offered under.
export {
  retailerIdOfVariant,
  resolveVariantRetailerIds,
  shareRetailerId,
  variantPriceOf,
  type ResolvedVariantRef,
} from './catalog-variants';
export { variantSellable } from './variant-rules';
// Sending a catalog message to given numbers (the inbox conversation's Catalog picker calls it for one number, TW-CAT-031).
export { CatalogSendService } from './catalog-send.service';
// A product list that comes from outside (the Sheets add-on) is written through the form's own create and update (TW-EXT-010).
export { ProductsService, type IntegrationProductInput } from './products.service';
export { ProductsRepository, recomputeProductAggregate } from './products.repository';
