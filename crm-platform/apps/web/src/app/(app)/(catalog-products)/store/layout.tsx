import type { ReactNode } from 'react';
import { StoreShell } from '@/features/storefront-builder';

/**
 * The store rail (WD-CAT-036): the product list, the product form and the reviews pages sit beside the store sidebar, as in
 * WaDesk. The rail copes with a workspace that has no shop (WaDesk answered 500 there), so these pages never depend on one.
 */
export default function CatalogStoreLayout({ children }: { children: ReactNode }) {
  return <StoreShell>{children}</StoreShell>;
}
