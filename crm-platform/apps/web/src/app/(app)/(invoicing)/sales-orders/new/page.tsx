import { Suspense } from 'react';
import { SalesOrderBuilder } from '@/features/invoicing/components/sales-order-builder';

export default function NewSalesOrderPage() {
  return (
    <Suspense>
      <SalesOrderBuilder />
    </Suspense>
  );
}
