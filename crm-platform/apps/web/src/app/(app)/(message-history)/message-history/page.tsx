import { Suspense } from 'react';
import { PageLoading } from '@/components/page-loader';
import { MessageHistoryScreen } from '@/features/message-history';

export default function MessageHistoryPage() {
  // The screen keeps every filter in the address, which needs a Suspense boundary.
  return (
    <Suspense fallback={<PageLoading />}>
      <MessageHistoryScreen />
    </Suspense>
  );
}
