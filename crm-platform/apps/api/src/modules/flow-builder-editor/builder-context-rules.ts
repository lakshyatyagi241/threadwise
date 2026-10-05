import {
  flbIsFlowType,
  type FlbCommerceProduct,
  type FlbStore,
  type FlowType,
} from '@crm/contracts';

/**
 * Pure rules of the builder's reference data (TW-FLB-026, 052): how a row of another domain becomes the label or option the
 * builder shows. Kept apart from `BuilderContextService` (which only reads rows) so they are unit-tested without a database.
 */

type Raw = Record<string, unknown>;
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
/** First non-empty string of the arguments (PHP's `a ?: b ?: c`: empty strings and null fall through). */
const firstOf = (...v: unknown[]): string => {
  for (const x of v) {
    const t = s(x);
    if (t !== '') return t;
  }
  return '';
};

/** `@username`, else `@account <id>` (Reference's Instagram account label). */
export const instagramLabel = (r: Raw): string => `@${firstOf(r.username) || `account ${s(r.id)}`}`;

/** Mailbox label: its name, else its address, else `Email <id>`. */
export const emailLabel = (r: Raw): string => firstOf(r.name, r.email) || `Email ${s(r.id)}`;

/** WhatsApp catalog label: the catalog name, else `Catalog <catalog id>`. */
export const catalogStoreName = (name: unknown, catalogId: unknown): string =>
  firstOf(name) || `Catalog ${s(catalogId)}`;

/** A WooCommerce / Shopify store option: store name, else its URL; the currency is the store's own (null when unset). */
export const storeOption = (r: Raw): FlbStore => ({
  id: s(r.uuid),
  name: firstOf(r.store_name, r.store_url),
  currency: firstOf(r.currency) || null,
});

/** A form counts as published only when it was also pushed to Meta (Reference `isLive`: status published AND a Meta flow id). */
export const formIsLive = (status: unknown, metaFlowId: unknown): boolean =>
  s(status).toLowerCase() === 'published' && s(metaFlowId) !== '';

/** The channel a stored flow runs on; an unknown or empty stored value is `chat` (Reference `flow_type ?? 'chat'`). */
export const flowTypeOf = (v: unknown): FlowType => (flbIsFlowType(v) ? v : 'chat');

/** One `wa_products` row as the product picker offers it. */
export function productOption(r: Raw): FlbCommerceProduct {
  return {
    id: s(r.uuid),
    retailerId: firstOf(r.retailer_id),
    name: s(r.name),
    sku: firstOf(r.sku) || null,
    image: firstOf(r.image_url) || null,
    priceMinor:
      r.price_minor === null || r.price_minor === undefined ? null : Number(r.price_minor),
    currency: firstOf(r.currency_code) || null,
    url: firstOf(r.product_url) || null,
    inStock: r.in_stock === true,
  };
}
