import { Suspense } from 'react';
import { GatewaysScreen } from '@/features/checkout-orders-merchant-payments';

export default function GatewaysPage() {
  // The screen reads the address (`?shop=` and its filters), which needs a Suspense boundary.
  return (
    <Suspense>
      <GatewaysScreen />
    </Suspense>
  );
}
