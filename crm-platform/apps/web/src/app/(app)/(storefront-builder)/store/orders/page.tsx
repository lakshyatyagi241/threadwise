import { Suspense } from 'react';
import { OrdersScreen } from '@/features/checkout-orders-merchant-payments';

export default function OrdersPage() {
  // The screen reads the address (`?shop=` and its filters), which needs a Suspense boundary.
  return (
    <Suspense>
      <OrdersScreen />
    </Suspense>
  );
}
