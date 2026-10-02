import { Suspense } from 'react';
import { InboxScreen } from '@/features/team-inbox-conversations';

export default function InboxPage() {
  // The screen reads the open conversation from the address (`?c=`), which needs a Suspense boundary.
  return (
    <Suspense>
      <InboxScreen />
    </Suspense>
  );
}
