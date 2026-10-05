import { Suspense } from 'react';
import { HubScreen } from '@/features/channel-instagram/components/hub-screen';

export default function InstagramPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <HubScreen />
    </Suspense>
  );
}
