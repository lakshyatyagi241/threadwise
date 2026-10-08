import { Suspense } from 'react';
import { CouponsScreen } from '@/features/checkout-orders-merchant-payments';

export default function CouponsPage() {
  // The screen reads the address (`?shop=` and its filters), which needs a Suspense boundary.
  return (
    <Suspense>
      <CouponsScreen />
    </Suspense>
  );
}
