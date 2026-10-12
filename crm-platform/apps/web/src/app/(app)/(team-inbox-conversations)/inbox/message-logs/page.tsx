import { Suspense } from 'react';
import { MessageLogsScreen } from '@/features/team-inbox-conversations';

export default function InboxMessageLogsPage() {
  // `useSearchParams` (the export a mail links to) needs a boundary above it.
  return (
    <Suspense fallback={null}>
      <MessageLogsScreen />
    </Suspense>
  );
}
