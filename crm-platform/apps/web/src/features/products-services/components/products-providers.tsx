'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Products and services screen. */
export function ProductsProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('products-services.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
