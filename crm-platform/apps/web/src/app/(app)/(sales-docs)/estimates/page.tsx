import { Suspense } from 'react';
import { SalesDocsScreen } from '@/features/sales-docs';

export default function EstimatesPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <SalesDocsScreen kind="estimate" />
    </Suspense>
  );
}
