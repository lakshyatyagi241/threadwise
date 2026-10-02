'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the store screens (one region, translated dismiss label). */
export function EcomProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('ecom.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
