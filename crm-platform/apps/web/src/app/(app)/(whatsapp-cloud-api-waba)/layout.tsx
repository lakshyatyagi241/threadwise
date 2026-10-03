import type { ReactNode } from 'react';
import { WabaProviders } from '@/features/whatsapp-cloud-api-waba/components/providers';

/** Shared frame of the WABA screens: the toast region. */
export default function WabaDomainLayout({ children }: { children: ReactNode }) {
  return <WabaProviders>{children}</WabaProviders>;
}
