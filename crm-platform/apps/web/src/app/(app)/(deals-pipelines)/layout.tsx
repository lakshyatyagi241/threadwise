import type { ReactNode } from 'react';
import { DealsProviders } from '@/features/deals-pipelines/components/providers';

/** Shared frame of the deals screens: the toast region. */
export default function DealsDomainLayout({ children }: { children: ReactNode }) {
  return <DealsProviders>{children}</DealsProviders>;
}
