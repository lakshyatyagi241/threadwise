import type { ReactNode } from 'react';
import { InvoicingProviders } from '@/features/invoicing/components/providers';

/** Shared frame of the Invoices, Payments and Tax rates screens: the toast region and the sample-data reminder. */
export default function InvoicingDomainLayout({ children }: { children: ReactNode }) {
  return <InvoicingProviders>{children}</InvoicingProviders>;
}
