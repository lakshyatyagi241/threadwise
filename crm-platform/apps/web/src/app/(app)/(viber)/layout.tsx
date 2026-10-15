import type { ReactNode } from 'react';
import { ViberProviders } from '@/features/channel-viber/components/viber-providers';

/** Shared frame of the Viber screens: the toast region. */
export default function ViberDomainLayout({ children }: { children: ReactNode }) {
  return <ViberProviders>{children}</ViberProviders>;
}
