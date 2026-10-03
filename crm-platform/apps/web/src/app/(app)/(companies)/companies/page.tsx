import { Suspense } from 'react';
import { CompaniesScreen } from '@/features/companies';

export default function CompaniesPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <CompaniesScreen />
    </Suspense>
  );
}
