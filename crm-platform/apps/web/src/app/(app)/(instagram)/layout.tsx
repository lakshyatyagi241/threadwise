import type { ReactNode } from 'react';
import { InstagramProviders } from '@/features/channel-instagram/components/instagram-providers';

/** Shared frame of the Instagram screens: the toast region. */
export default function InstagramDomainLayout({ children }: { children: ReactNode }) {
  return <InstagramProviders>{children}</InstagramProviders>;
}
