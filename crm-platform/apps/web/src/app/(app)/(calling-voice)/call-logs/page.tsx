import { Suspense } from 'react';
import { CallLogsScreen } from '@/features/calling-voice/components/call-logs-screen';

export default function CallLogsPage() {
  // The screen reads the filters from the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <CallLogsScreen />
    </Suspense>
  );
}
