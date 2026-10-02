import { Suspense } from 'react';
import { RecurringInvoiceDetail } from '@/features/invoicing/components/recurring-detail';

export default async function RecurringInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <RecurringInvoiceDetail id={id} />
    </Suspense>
  );
}
