import { Suspense } from 'react';
import { BroadcastsScreen } from '@/features/broadcasts/components/broadcasts-screen';

/** Broadcasts sent before they became campaigns, still readable (the old list, kept for existing rows). */
export default function LegacyBroadcastsPage() {
  // The screen reads the URL's filters, which needs a Suspense boundary.
  return (
    <Suspense>
      <BroadcastsScreen />
    </Suspense>
  );
}
