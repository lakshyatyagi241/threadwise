import { Suspense } from 'react';
import { SimpleRoute } from '@/features/flow-builder-editor/builder/simple/simple-route';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditSimpleFlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <SimpleRoute flowId={UUID.test(id) ? id : undefined} />
    </Suspense>
  );
}
