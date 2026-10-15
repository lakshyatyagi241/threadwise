import type { ReactNode } from 'react';
import { PrivacyShell } from '@/features/privacy-requests/components/privacy-shell';

/** One frame for the /privacy-requests screens: the toasts. */
export default function PrivacyRequestsLayout({ children }: { children: ReactNode }) {
  return <PrivacyShell>{children}</PrivacyShell>;
}
