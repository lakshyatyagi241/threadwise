import type { ReactNode } from 'react';
import { SmsProviders } from '@/features/channel-sms/components/sms-providers';

/** Shared frame of the SMS screens: the toast region. */
export default function SmsDomainLayout({ children }: { children: ReactNode }) {
  return <SmsProviders>{children}</SmsProviders>;
}
