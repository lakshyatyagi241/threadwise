import { Suspense } from 'react';
import { BroadcastsScreen } from '@/features/broadcasts/components/broadcasts-screen';

export default function BroadcastsPage() {
  // The screen reads the URL's filters, which needs a Suspense boundary.
  return (
    <Suspense>
      <BroadcastsScreen />
    </Suspense>
  );
}
