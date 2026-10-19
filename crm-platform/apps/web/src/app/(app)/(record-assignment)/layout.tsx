import type { ReactNode } from 'react';
import { RecordAssignmentProviders } from '@/features/record-assignment/components/providers';

/** Shared frame of the Record assignment rules screen: the toast region its toasts need. */
export default function RecordAssignmentDomainLayout({ children }: { children: ReactNode }) {
  return <RecordAssignmentProviders>{children}</RecordAssignmentProviders>;
}
