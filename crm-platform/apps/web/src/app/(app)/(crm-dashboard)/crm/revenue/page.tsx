import { Suspense } from 'react';
import { RevenueScreen } from '@/features/crm-dashboard/revenue/components/revenue-screen';

export default function RevenueReportPage() {
  // The screen keeps its filters in the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <RevenueScreen />
    </Suspense>
  );
}
