import type { ReactNode } from 'react';
import { TeamChatProviders } from '@/features/team-chat/components/providers';

/** Shared frame of the team-chat screens: the toast region. */
export default function TeamChatDomainLayout({ children }: { children: ReactNode }) {
  return <TeamChatProviders>{children}</TeamChatProviders>;
}
