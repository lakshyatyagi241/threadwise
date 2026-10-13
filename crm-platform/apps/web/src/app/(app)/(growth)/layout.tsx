import type { ReactNode } from 'react';
import { GrowthShell } from '@/features/growth/components/growth-shell';

/** One frame for the /growth screen: the toasts. */
export default function GrowthDomainLayout({ children }: { children: ReactNode }) {
  return <GrowthShell>{children}</GrowthShell>;
}
