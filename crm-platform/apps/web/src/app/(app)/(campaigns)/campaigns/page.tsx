import { Suspense } from 'react';
import { CampaignsScreen } from '@/features/campaigns/components/campaigns-screen';
import { EarlierScreen } from '@/features/campaigns/earlier/components/earlier-screen';

/** `/campaigns`: every campaign; `?source=earlier` shows the broadcasts sent before Campaigns absorbed Broadcast. */
export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string | string[] }>;
}) {
  const { source } = await searchParams;
  // The screens read the filters from the address, which needs a Suspense boundary.
  return <Suspense>{source === 'earlier' ? <EarlierScreen /> : <CampaignsScreen />}</Suspense>;
}
