import { Suspense } from 'react';
import { FlowsScreen } from '@/features/flow-builder-editor/components/flows-screen';

export default function FlowsPage() {
  // The screen reads the URL's filters, which needs a Suspense boundary.
  return (
    <Suspense>
      <FlowsScreen />
    </Suspense>
  );
}
