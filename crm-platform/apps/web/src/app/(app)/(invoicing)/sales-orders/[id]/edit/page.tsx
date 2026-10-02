import { Suspense } from 'react';
import { SalesOrderBuilder } from '@/features/invoicing/components/sales-order-builder';

export default async function EditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <SalesOrderBuilder orderId={id} />
    </Suspense>
  );
}
