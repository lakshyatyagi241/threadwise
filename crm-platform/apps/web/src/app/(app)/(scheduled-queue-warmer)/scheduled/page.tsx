import { Suspense } from 'react';
import { ScheduledScreen } from '@/features/scheduled-queue-warmer/components/scheduled-screen';

export default function ScheduledPage() {
  // The screen reads the tab and search from the address, which needs a Suspense boundary.
  return (
    <Suspense>
      <ScheduledScreen />
    </Suspense>
  );
}
