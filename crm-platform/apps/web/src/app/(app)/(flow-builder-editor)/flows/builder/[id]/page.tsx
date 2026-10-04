import { Suspense } from 'react';
import { BuilderRoute } from '@/features/flow-builder-editor/builder/builder-route';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // A non-uuid id is "not one of ours": a blank new-flow canvas, as Reference does for an unknown id.
  return (
    <Suspense>
      <BuilderRoute flowId={UUID.test(id) ? id : undefined} />
    </Suspense>
  );
}
