import { Suspense } from 'react';
import { CrmDashboardScreen } from '@/features/crm-dashboard/components/crm-dashboard-screen';

export default function CrmDashboardPage() {
  // The screen keeps its filters in the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <CrmDashboardScreen />
    </Suspense>
  );
}
