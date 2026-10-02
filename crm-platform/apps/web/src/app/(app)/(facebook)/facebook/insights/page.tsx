import { Suspense } from 'react';
import { InsightsScreen } from '@/features/channel-facebook/components/insights-screen';

export default function FacebookInsightsPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <InsightsScreen />
    </Suspense>
  );
}
