import { Suspense } from 'react';
import { RecurringInvoiceBuilder } from '@/features/invoicing/components/recurring-builder';

export default function NewRecurringInvoicePage() {
  return (
    <Suspense>
      <RecurringInvoiceBuilder />
    </Suspense>
  );
}
