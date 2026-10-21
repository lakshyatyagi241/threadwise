import type { ReactNode } from 'react';
import { MeetingConferencingProviders } from '@/features/meeting-conferencing/components/providers';

/** Shared frame of the Video meetings screen: the toast region. */
export default function MeetingConferencingDomainLayout({ children }: { children: ReactNode }) {
  return <MeetingConferencingProviders>{children}</MeetingConferencingProviders>;
}
