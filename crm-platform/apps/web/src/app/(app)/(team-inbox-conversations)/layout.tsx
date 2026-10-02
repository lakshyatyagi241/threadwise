import type { ReactNode } from 'react';
import { InboxProviders } from '@/features/team-inbox-conversations/components/providers';

/** Shared frame of the inbox screens: the toast region. */
export default function InboxDomainLayout({ children }: { children: ReactNode }) {
  return <InboxProviders>{children}</InboxProviders>;
}
