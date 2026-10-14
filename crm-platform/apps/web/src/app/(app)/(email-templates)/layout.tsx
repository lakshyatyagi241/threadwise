import type { ReactNode } from 'react';
import { EmailTemplatesProviders } from '@/features/email-templates';

/** Shared frame of the Email templates screen: the toast region. */
export default function EmailTemplatesDomainLayout({ children }: { children: ReactNode }) {
  return <EmailTemplatesProviders>{children}</EmailTemplatesProviders>;
}
