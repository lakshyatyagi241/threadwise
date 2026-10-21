import { Suspense } from 'react';
import { CampaignsScreen } from '@/features/campaigns/components/campaigns-screen';

/** `/campaigns`: every campaign and its state, with the filters in the address. */
export default function CampaignsPage() {
  // The screen reads the filters from the address, which needs a Suspense boundary.
  return (
    <Suspense>
      <CampaignsScreen />
    </Suspense>
  );
}
