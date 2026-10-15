import { Suspense } from 'react';
import { GoogleConsentConfirm } from '@/features/google-account/components/google-consent-confirm';

export default function GoogleConsentConfirmPage() {
  // The confirmation reads the address (`useSearchParams`) for the request it is about, which needs a Suspense boundary.
  return (
    <Suspense>
      <GoogleConsentConfirm />
    </Suspense>
  );
}
