import type { ReactNode } from 'react';
import { ConsentShell } from '@/features/contact-consent/components/consent-shell';

/** One frame for the /contact-consent screen: the toasts. */
export default function ContactConsentDomainLayout({ children }: { children: ReactNode }) {
  return <ConsentShell>{children}</ConsentShell>;
}
