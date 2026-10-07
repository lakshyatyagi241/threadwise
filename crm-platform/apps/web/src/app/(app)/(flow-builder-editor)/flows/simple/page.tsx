import { Suspense } from 'react';
import { SimpleRoute } from '@/features/flow-builder-editor/builder/simple/simple-route';

/** `/flows/simple`: a new flow in the Simple (step-by-step) builder. */
export default function NewSimpleFlowPage() {
  return (
    <Suspense>
      <SimpleRoute />
    </Suspense>
  );
}
