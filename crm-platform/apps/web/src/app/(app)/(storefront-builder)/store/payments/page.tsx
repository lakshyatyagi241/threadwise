import { Suspense } from 'react';
import { PaymentsScreen } from '@/features/checkout-orders-merchant-payments';

export default function PaymentsPage() {
  // The screen reads the address (`?shop=` and its filters), which needs a Suspense boundary.
  return (
    <Suspense>
      <PaymentsScreen />
    </Suspense>
  );
}
