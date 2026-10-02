import type { ReactNode } from 'react';
import { BroadcastsProviders } from '@/features/broadcasts/components/broadcasts-providers';

/** Shared frame of the broadcast screens: the toast region. */
export default function BroadcastsDomainLayout({ children }: { children: ReactNode }) {
  return <BroadcastsProviders>{children}</BroadcastsProviders>;
}
