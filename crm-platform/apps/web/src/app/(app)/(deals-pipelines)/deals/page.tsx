import { Suspense } from 'react';
import { DealsScreen } from '@/features/deals-pipelines/components/deals-screen';

export default function DealsPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <DealsScreen />
    </Suspense>
  );
}
