import { Suspense } from 'react';
import { SegmentsScreen } from '@/features/segments/components/segments-screen';

export default function SegmentsPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <SegmentsScreen />
    </Suspense>
  );
}
