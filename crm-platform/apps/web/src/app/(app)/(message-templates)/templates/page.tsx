import { Suspense } from 'react';
import { TemplatesScreen } from '@/features/message-templates/components/templates-screen';

export default function TemplatesPage() {
  // The library keeps its filters in the URL, which a page can only read under a Suspense boundary.
  return (
    <Suspense>
      <TemplatesScreen />
    </Suspense>
  );
}
