import { Suspense } from 'react';
import { SetupScreen } from '@/features/channel-facebook/components/setup-screen';

export default function FacebookSetupPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <SetupScreen />
    </Suspense>
  );
}
