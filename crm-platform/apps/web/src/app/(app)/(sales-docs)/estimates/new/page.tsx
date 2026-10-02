import { Suspense } from 'react';
import { BuilderScreen } from '@/features/sales-docs';

export default function NewEstimatePage() {
  // The builder reads `?contact=` and `?deal=` (a new estimate started from a contact or a deal).
  return (
    <Suspense>
      <BuilderScreen kind="estimate" />
    </Suspense>
  );
}
