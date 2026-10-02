import { Suspense } from 'react';
import { OrdersPage } from '@/features/platform-payment-gateways/components/orders-page';

export default function BillingOrdersPage() {
  // The page reads ?payment= (the result of a payment just made), which needs a Suspense boundary.
  return (
    <Suspense>
      <OrdersPage />
    </Suspense>
  );
}
