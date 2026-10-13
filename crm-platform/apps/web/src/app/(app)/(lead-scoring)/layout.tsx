import type { ReactNode } from 'react';
import { LeadScoringShell } from '@/features/lead-scoring/components/lead-scoring-shell';

/** One frame for the /lead-scoring screens: the toasts. */
export default function LeadScoringDomainLayout({ children }: { children: ReactNode }) {
  return <LeadScoringShell>{children}</LeadScoringShell>;
}
