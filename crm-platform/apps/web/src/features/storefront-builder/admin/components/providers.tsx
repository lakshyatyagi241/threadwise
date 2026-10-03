'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the admin store screens (one region, translated dismiss label). */
export function StoreProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('storefront-builder.admin.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
