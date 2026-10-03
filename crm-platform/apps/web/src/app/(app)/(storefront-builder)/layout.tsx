import type { ReactNode } from 'react';
import { StoreProviders } from '@/features/storefront-builder/admin/components/providers';

/** Shared frame of the admin store screens: the toast region. */
export default function StorefrontBuilderLayout({ children }: { children: ReactNode }) {
  return <StoreProviders>{children}</StoreProviders>;
}
