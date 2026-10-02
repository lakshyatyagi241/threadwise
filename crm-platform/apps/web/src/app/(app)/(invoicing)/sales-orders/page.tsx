import { Suspense } from 'react';
import { SalesOrdersScreen } from '@/features/invoicing/components/sales-orders-screen';

export default function SalesOrdersPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <SalesOrdersScreen />
    </Suspense>
  );
}
