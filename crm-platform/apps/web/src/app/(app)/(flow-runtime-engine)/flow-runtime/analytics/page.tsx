import { Suspense } from 'react';
import { AnalyticsScreen } from '@/features/flow-runtime-engine/components/analytics-screen';

export default function FlowAnalyticsPage() {
  return (
    <Suspense>
      <AnalyticsScreen />
    </Suspense>
  );
}
