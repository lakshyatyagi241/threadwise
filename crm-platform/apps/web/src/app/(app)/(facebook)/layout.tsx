import type { ReactNode } from 'react';
import { FacebookProviders } from '@/features/channel-facebook/components/facebook-providers';

/** Shared frame of the Facebook screens: the toast region. */
export default function FacebookDomainLayout({ children }: { children: ReactNode }) {
  return <FacebookProviders>{children}</FacebookProviders>;
}
