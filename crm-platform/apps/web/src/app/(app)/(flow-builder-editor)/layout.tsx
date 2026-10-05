import type { ReactNode } from 'react';
import { FlowsProviders } from '@/features/flow-builder-editor/components/providers';

/** Shared frame of the flow screens: the toast region. */
export default function FlowsDomainLayout({ children }: { children: ReactNode }) {
  return <FlowsProviders>{children}</FlowsProviders>;
}
