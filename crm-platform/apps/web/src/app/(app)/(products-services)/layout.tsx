import type { ReactNode } from 'react';
import { ProductsProviders } from '@/features/products-services/components/products-providers';

/** Frame of the Products and services screen: the toast region. The app gate (`gates.app`) closes every route below for a workspace without the add-on. */
export default function ProductsDomainLayout({ children }: { children: ReactNode }) {
  return <ProductsProviders>{children}</ProductsProviders>;
}
