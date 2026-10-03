import { Suspense } from 'react';
import { DashboardScreen } from '@/features/storefront-builder/admin/components/dashboard-screen';

export default function StorePage() {
  // The screen reads the address (`?shop=`), which needs a Suspense boundary.
  return (
    <Suspense>
      <DashboardScreen />
    </Suspense>
  );
}
