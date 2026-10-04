import type { ReactNode } from 'react';
import { SchedProviders } from '@/features/scheduled-queue-warmer/components/providers';

/** Shared frame of the scheduled-message and warmer screens: the toast region. */
export default function ScheduledDomainLayout({ children }: { children: ReactNode }) {
  return <SchedProviders>{children}</SchedProviders>;
}
