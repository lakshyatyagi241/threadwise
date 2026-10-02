import { Suspense } from 'react';
import { DashboardScreen } from '@/features/dashboards-analytics-charts/components/dashboard-screen';

export default function DashboardPage() {
  // The screen reads the address (useSearchParams), which needs a Suspense boundary.
  return (
    <Suspense>
      <DashboardScreen />
    </Suspense>
  );
}
