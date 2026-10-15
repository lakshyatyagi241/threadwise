import type { ReactNode } from 'react';
import { LineProviders } from '@/features/channel-line/components/line-providers';

/** Shared frame of the LINE screens: the toast region. */
export default function LineDomainLayout({ children }: { children: ReactNode }) {
  return <LineProviders>{children}</LineProviders>;
}
