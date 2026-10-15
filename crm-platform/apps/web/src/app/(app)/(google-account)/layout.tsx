import type { ReactNode } from 'react';
import { GoogleAccountProviders } from '@/features/google-account/components/providers';

/** Shared frame of the Google account screen: the toast region. */
export default function GoogleAccountDomainLayout({ children }: { children: ReactNode }) {
  return <GoogleAccountProviders>{children}</GoogleAccountProviders>;
}
