import { Suspense } from 'react';
import { CustomersScreen } from '@/features/checkout-orders-merchant-payments';

export default function CustomersPage() {
  // The screen reads the address (`?shop=` and its filters), which needs a Suspense boundary.
  return (
    <Suspense>
      <CustomersScreen />
    </Suspense>
  );
}
