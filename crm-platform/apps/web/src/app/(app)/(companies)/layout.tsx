import type { ReactNode } from 'react';
import { CompaniesProviders } from '@/features/companies';

/** Shared frame of the Companies screens: the toast region. */
export default function CompaniesDomainLayout({ children }: { children: ReactNode }) {
  return <CompaniesProviders>{children}</CompaniesProviders>;
}
