import type { ReactNode } from 'react';
import { LeadProviders } from '@/features/lead-sources/components/ui';

/** Shared frame of the Social leads screens: the toast region. */
export default function LeadSourcesDomainLayout({ children }: { children: ReactNode }) {
  return <LeadProviders>{children}</LeadProviders>;
}
