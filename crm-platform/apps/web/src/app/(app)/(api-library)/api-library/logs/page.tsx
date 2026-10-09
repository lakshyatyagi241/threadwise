import { Suspense } from 'react';
import { LogsScreen } from '@/features/api-library/components/logs-screen';

export default function ApiLibraryLogsPage() {
  return (
    <Suspense>
      <LogsScreen />
    </Suspense>
  );
}
