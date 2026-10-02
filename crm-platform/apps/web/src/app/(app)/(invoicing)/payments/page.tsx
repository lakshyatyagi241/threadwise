import { Suspense } from 'react';
import { PaymentsScreen } from '@/features/invoicing/components/payments-screen';

export default function PaymentsPage() {
  return (
    <Suspense>
      <PaymentsScreen />
    </Suspense>
  );
}
