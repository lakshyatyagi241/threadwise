import type { ReactNode } from 'react';
import { HistoryProviders } from '@/features/message-history';

/** Shared frame of the Message History screen: the toast region. */
export default function MessageHistoryLayout({ children }: { children: ReactNode }) {
  return <HistoryProviders>{children}</HistoryProviders>;
}
