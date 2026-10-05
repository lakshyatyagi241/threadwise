import { Suspense } from 'react';
import { StoreInvoicesScreen } from '@/features/checkout-orders-merchant-payments';

export default function StoreInvoicesPage() {
  // The screen reads the address (`?shop=` and its filters), which needs a Suspense boundary.
  return (
    <Suspense>
      <StoreInvoicesScreen />
    </Suspense>
  );
}
