import type { ReactNode } from 'react';
import { FaqShell } from '@/features/faq-knowledge/components/faq-shell';

/** One frame for every /faq screen: toasts, the sub-navigation with the Unanswered count, and the state banner. */
export default function FaqDomainLayout({ children }: { children: ReactNode }) {
  return <FaqShell>{children}</FaqShell>;
}
