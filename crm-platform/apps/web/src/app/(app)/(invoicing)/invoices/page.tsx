import { Suspense } from 'react';
import { InvoicesScreen } from '@/features/invoicing/components/invoices-screen';

export default function InvoicesPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <InvoicesScreen />
    </Suspense>
  );
}
