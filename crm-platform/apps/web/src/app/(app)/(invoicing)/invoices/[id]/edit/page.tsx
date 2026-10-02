import { Suspense } from 'react';
import { InvoiceBuilder } from '@/features/invoicing/components/invoice-builder';

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <InvoiceBuilder invoiceId={id} />
    </Suspense>
  );
}
