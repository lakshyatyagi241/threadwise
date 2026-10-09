import type { ReactNode } from 'react';
import { ApiLibraryProviders } from '@/features/api-library/components/providers';

/** Shared frame of the API Library screens: the toast region. */
export default function ApiLibraryDomainLayout({ children }: { children: ReactNode }) {
  return <ApiLibraryProviders>{children}</ApiLibraryProviders>;
}
