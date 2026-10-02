import type { ReactNode } from 'react';
import { SalesDocsProviders } from '@/features/sales-docs';

/** Shared frame of the Proposals and Estimates screens: the toast region. */
export default function SalesDocsDomainLayout({ children }: { children: ReactNode }) {
  return <SalesDocsProviders>{children}</SalesDocsProviders>;
}
