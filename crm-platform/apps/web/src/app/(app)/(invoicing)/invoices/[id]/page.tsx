import { Suspense } from 'react';
import { InvoiceDetail } from '@/features/invoicing/components/invoice-detail';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <InvoiceDetail id={id} />
    </Suspense>
  );
}
