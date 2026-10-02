import { Suspense } from 'react';
import { SalesOrderDetail } from '@/features/invoicing/components/sales-order-detail';

export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <SalesOrderDetail id={id} />
    </Suspense>
  );
}
