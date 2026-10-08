import { Suspense } from 'react';
import { EmbeddedShopify } from '@/features/shopify-woocommerce/components/embedded-shopify';

/**
 * Shopify's admin loads `/shopify?host=...&shop=...` in an iframe; `proxy.ts` serves that here, outside the app shell (no menu, no
 * sign-in redirect), because the merchant is not signed in to this app inside Shopify (TW-ECOM-038).
 */
export default function ShopifyEmbeddedPage() {
  return (
    <Suspense>
      <EmbeddedShopify />
    </Suspense>
  );
}
