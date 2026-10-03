import type { ReactNode } from 'react';
import { CatalogProductsProviders } from '@/features/catalog-products';

/** Shared frame of the catalog and product screens: the toast region. */
export default function CatalogProductsDomainLayout({ children }: { children: ReactNode }) {
  return <CatalogProductsProviders>{children}</CatalogProductsProviders>;
}
