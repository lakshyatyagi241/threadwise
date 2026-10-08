import { Suspense } from 'react';
import { GroupsScreen } from '@/features/checkout-orders-merchant-payments';

export default function GroupsPage() {
  // The screen reads the address (`?shop=` and its filters), which needs a Suspense boundary.
  return (
    <Suspense>
      <GroupsScreen />
    </Suspense>
  );
}
