import { Suspense } from 'react';
import { ApiListScreen } from '@/features/api-library/components/api-list-screen';

export default function ApiLibraryPage() {
  // The list keeps its page and page size in the query string, which a client page reads under a Suspense boundary.
  return (
    <Suspense>
      <ApiListScreen />
    </Suspense>
  );
}
