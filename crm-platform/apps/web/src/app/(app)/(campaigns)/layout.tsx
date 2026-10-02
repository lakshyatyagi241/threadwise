import type { ReactNode } from 'react';
import { CampaignsProviders } from '@/features/campaigns/components/campaigns-providers';

/** Shared frame of the campaign screens: the toast region. */
export default function CampaignsDomainLayout({ children }: { children: ReactNode }) {
  return <CampaignsProviders>{children}</CampaignsProviders>;
}
