import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { DetailScreen } from '@/features/campaigns/components/detail-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  // The screen reads the selected tab from the address, which needs a Suspense boundary.
  return (
    <Suspense>
      <DetailScreen id={id} />
    </Suspense>
  );
}
