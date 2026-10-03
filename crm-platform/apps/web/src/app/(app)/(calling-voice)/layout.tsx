import type { ReactNode } from 'react';
import { CallingProviders } from '@/features/calling-voice/components/calling-providers';

/** Shared frame of the calling screens: the toast region. */
export default function CallingDomainLayout({ children }: { children: ReactNode }) {
  return <CallingProviders>{children}</CallingProviders>;
}
