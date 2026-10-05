import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { SubscribersScreen } from '@/features/flow-runtime-engine/components/subscribers-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FlowSubscribersPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const { flowId } = await params;
  if (!UUID.test(flowId)) notFound();
  return (
    <Suspense>
      <SubscribersScreen flowId={flowId} />
    </Suspense>
  );
}
