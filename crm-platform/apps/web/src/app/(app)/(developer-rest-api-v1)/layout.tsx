import type { ReactNode } from 'react';
import { DeveloperProviders } from '@/features/developer-rest-api-v1/components/providers';

/** Shared frame of the Developers screens: the toast region. */
export default function DeveloperDomainLayout({ children }: { children: ReactNode }) {
  return <DeveloperProviders>{children}</DeveloperProviders>;
}
