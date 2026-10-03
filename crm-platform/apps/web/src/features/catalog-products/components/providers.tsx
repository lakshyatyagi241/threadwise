'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the catalog and product screens (one region, translated dismiss label). */
export function CatalogProductsProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('catalogProducts.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
