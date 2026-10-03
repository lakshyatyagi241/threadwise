import { Suspense } from 'react';
import { BuilderRoute } from '@/features/flow-builder-editor/builder/builder-route';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/flows/builder`: a new flow. `?id=<uuid>` is accepted as a fallback for an existing one (WaDesk's redirects arrive that
 * way); an unknown id gives a blank canvas, not a 404.
 */
export default async function NewBuilderPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  return (
    <Suspense>
      <BuilderRoute flowId={id && UUID.test(id) ? id : undefined} />
    </Suspense>
  );
}
