import { Suspense } from 'react';
import { RunsScreen } from '@/features/flow-runtime-engine/components/runs-screen';

export default function FlowRunsPage() {
  // The screen reads the URL's filters, which needs a Suspense boundary.
  return (
    <Suspense>
      <RunsScreen />
    </Suspense>
  );
}
