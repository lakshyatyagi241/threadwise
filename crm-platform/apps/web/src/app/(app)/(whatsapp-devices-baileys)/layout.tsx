import type { ReactNode } from 'react';
import { DevicesProviders } from '@/features/whatsapp-devices-baileys/components/providers';

/** Shared frame of the personal-number screens: the toast region. */
export default function DevicesDomainLayout({ children }: { children: ReactNode }) {
  return <DevicesProviders>{children}</DevicesProviders>;
}
