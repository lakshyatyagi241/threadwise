import { Suspense } from 'react';
import { EmailTemplatesScreen } from '@/features/email-templates';

export default function EmailTemplatesPage() {
  // The screen reads the address (`useSearchParams`), which needs a Suspense boundary.
  return (
    <Suspense>
      <EmailTemplatesScreen />
    </Suspense>
  );
}
