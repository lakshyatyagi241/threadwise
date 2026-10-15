import { Suspense } from 'react';
import { TemplatesHome } from '@/features/message-templates/components/templates-home';

export default function TemplatesPage() {
  // The library keeps its filters in the URL, which a page can only read under a Suspense boundary.
  return (
    <Suspense>
      <TemplatesHome />
    </Suspense>
  );
}
