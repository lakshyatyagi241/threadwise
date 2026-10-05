import type { ReactNode } from 'react';
import { EcomProviders } from '@/features/shopify-woocommerce/components/ecom-providers';

/** Shared frame of the store screens: the toast region. */
export default function EcomDomainLayout({ children }: { children: ReactNode }) {
  return <EcomProviders>{children}</EcomProviders>;
}
