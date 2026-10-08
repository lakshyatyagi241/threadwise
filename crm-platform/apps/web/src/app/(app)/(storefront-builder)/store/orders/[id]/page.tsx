import { Suspense } from 'react';
import { OrderDetailScreen } from '@/features/checkout-orders-merchant-payments';

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <OrderDetailScreen id={id} />
    </Suspense>
  );
}
