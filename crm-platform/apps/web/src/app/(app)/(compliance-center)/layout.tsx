import type { ReactNode } from 'react';
import { ComplianceShell } from '@/features/compliance-center/components/compliance-shell';

/** One frame for the /compliance screen: the toasts. */
export default function ComplianceDomainLayout({ children }: { children: ReactNode }) {
  return <ComplianceShell>{children}</ComplianceShell>;
}
