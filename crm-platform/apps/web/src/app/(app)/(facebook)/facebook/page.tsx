import { Suspense } from 'react';
import { HubScreen } from '@/features/channel-facebook/components/hub-screen';

export default function FacebookPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <HubScreen />
    </Suspense>
  );
}
