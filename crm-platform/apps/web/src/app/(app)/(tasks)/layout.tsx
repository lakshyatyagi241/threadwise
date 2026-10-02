import type { ReactNode } from 'react';
import { TasksProviders } from '@/features/tasks/components/providers';

/** Shared frame of the Tasks screens: the toast region. */
export default function TasksDomainLayout({ children }: { children: ReactNode }) {
  return <TasksProviders>{children}</TasksProviders>;
}
