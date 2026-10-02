import { Suspense } from 'react';
import { CampaignsScreen } from '@/features/campaigns/components/campaigns-screen';

export default function CampaignsPage() {
  // The screen reads the filters from the address, which needs a Suspense boundary.
  return (
    <Suspense>
      <CampaignsScreen />
    </Suspense>
  );
}
