import type { ReactNode } from 'react';
import { MarketplaceProviders } from '@/features/marketplace/components/providers';

/** Shared frame of the Marketplace screens: the toast region. */
export default function MarketplaceDomainLayout({ children }: { children: ReactNode }) {
  return <MarketplaceProviders>{children}</MarketplaceProviders>;
}
