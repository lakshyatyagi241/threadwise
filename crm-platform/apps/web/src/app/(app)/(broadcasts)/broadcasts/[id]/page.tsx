import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { BroadcastDetailScreen } from '@/features/broadcasts/components/detail-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BroadcastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  // The screen reads the selected tab from the address, which needs a Suspense boundary.
  return (
    <Suspense>
      <BroadcastDetailScreen id={id} />
    </Suspense>
  );
}
