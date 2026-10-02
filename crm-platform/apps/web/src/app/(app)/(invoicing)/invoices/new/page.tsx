import { Suspense } from 'react';
import { InvoiceBuilder } from '@/features/invoicing/components/invoice-builder';

export default function NewInvoicePage() {
  return (
    <Suspense>
      <InvoiceBuilder />
    </Suspense>
  );
}
