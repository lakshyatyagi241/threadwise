/**
 * Public surface of the public shop (buyer-facing storefront). Server-only: the pages read the API directly.
 *
 * Custom-domain root serving (WD-STORE-021): the root route calls `resolveShopForHost(host)` and, when it returns a slug,
 * renders `<ShopHome slug={slug} page={pageParam(searchParams.page)} />` (and `shopHomeMetadata` for the head).
 */
export { resolveShopForHost } from './api/server';
export { ShopHome, pageParam, shopHomeMetadata } from './pages/home';
export { ShopOrder, shopOrderMetadata } from './pages/order';
export { ShopProduct, shopProductMetadata } from './pages/product';
