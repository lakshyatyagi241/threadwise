import type { ReactNode } from 'react';
import { RoutingProviders } from '@/features/team-inbox-routing-sla/components/providers';

/** Shared frame of the Auto-assignment screens: the toast region. */
export default function RoutingDomainLayout({ children }: { children: ReactNode }) {
  return <RoutingProviders>{children}</RoutingProviders>;
}
