import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { EarlierDetailScreen } from '@/features/campaigns/earlier/components/detail-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One broadcast sent before Campaigns absorbed Broadcast: its overview, recipients, failures and events. */
export default async function EarlierBroadcastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  // The screen reads the selected tab from the address, which needs a Suspense boundary.
  return (
    <Suspense>
      <EarlierDetailScreen id={id} />
    </Suspense>
  );
}
