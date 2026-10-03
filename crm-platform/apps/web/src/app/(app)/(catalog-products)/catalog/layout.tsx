import type { ReactNode } from 'react';
import { CatalogShell } from '@/features/catalog-products';

/** The four catalog tabs share the header strip, the connection pill and the tab links. */
export default function CatalogLayout({ children }: { children: ReactNode }) {
  return <CatalogShell>{children}</CatalogShell>;
}
