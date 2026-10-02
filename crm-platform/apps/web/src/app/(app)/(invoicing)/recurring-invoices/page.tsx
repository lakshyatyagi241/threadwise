import { Suspense } from 'react';
import { RecurringInvoicesScreen } from '@/features/invoicing/components/recurring-screen';

export default function RecurringInvoicesPage() {
  return (
    <Suspense>
      <RecurringInvoicesScreen />
    </Suspense>
  );
}
