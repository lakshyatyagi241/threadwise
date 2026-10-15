import { Suspense } from 'react';
import { GoogleAccountScreen } from '@/features/google-account/components/google-account-screen';

export default function GoogleAccountPage() {
  // The screen reads the address (`useSearchParams`) for the outcome Google's callback leaves, which needs a Suspense boundary.
  return (
    <Suspense>
      <GoogleAccountScreen />
    </Suspense>
  );
}
