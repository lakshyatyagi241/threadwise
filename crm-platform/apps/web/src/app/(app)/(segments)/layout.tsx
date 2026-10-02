import type { ReactNode } from 'react';
import { SegmentProviders } from '@/features/segments/components/parts';

/** Shared frame of the Segments screens: the toast region. */
export default function SegmentsDomainLayout({ children }: { children: ReactNode }) {
  return <SegmentProviders>{children}</SegmentProviders>;
}
