import { Suspense } from 'react';
import { StoreScreen } from '@/features/shopify-woocommerce/components/store-screen';

export default function ShopifyPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <StoreScreen kind="shopify" />
    </Suspense>
  );
}
