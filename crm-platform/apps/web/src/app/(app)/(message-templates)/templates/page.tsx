import { Suspense } from 'react';
import { TemplatesScreen } from '@/features/message-templates/components/templates-screen';
import { baseUrlOf } from '@/features/developer-rest-api-v1/lib/keys-model';
import { publicApiOrigin } from '@/features/developer-rest-api-v1/docs/lib/load-spec';

// The customer API's address comes from the server's environment at request time, not from the build.
export const dynamic = 'force-dynamic';

export default function TemplatesPage() {
  // The library keeps its filters in the URL, which a page can only read under a Suspense boundary. The customer API's address is read
  // here, on the server, for the "Copy cURL" example of a template.
  return (
    <Suspense>
      <TemplatesScreen apiBaseUrl={baseUrlOf(publicApiOrigin())} />
    </Suspense>
  );
}
