import type { ReactNode } from 'react';
import { FlrProviders } from '@/features/flow-runtime-engine/components/parts';

/** Shared frame of the flow runtime screens: the toast region. */
export default function FlowRuntimeLayout({ children }: { children: ReactNode }) {
  return <FlrProviders>{children}</FlrProviders>;
}
