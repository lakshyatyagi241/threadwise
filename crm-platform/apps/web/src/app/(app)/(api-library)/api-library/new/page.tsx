import { Suspense } from 'react';
import { ApiFormScreen } from '@/features/api-library/components/api-form-screen';

export default function NewApiPage() {
  // The form reads `?from=curl` (a cURL import); a client page that reads the query needs a Suspense boundary to build statically.
  return (
    <Suspense>
      <ApiFormScreen />
    </Suspense>
  );
}
