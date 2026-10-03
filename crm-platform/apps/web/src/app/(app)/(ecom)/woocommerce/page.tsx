import { Suspense } from 'react';
import { StoreScreen } from '@/features/shopify-woocommerce/components/store-screen';

export default function WoocommercePage() {
  return (
    <Suspense>
      <StoreScreen kind="woocommerce" />
    </Suspense>
  );
}
