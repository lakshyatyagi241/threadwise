import type { ReactNode } from 'react';
import { EmailProviders } from '@/features/channel-email/components/email-providers';

/** Shared frame of the email screens: the toast region. */
export default function EmailDomainLayout({ children }: { children: ReactNode }) {
  return <EmailProviders>{children}</EmailProviders>;
}
