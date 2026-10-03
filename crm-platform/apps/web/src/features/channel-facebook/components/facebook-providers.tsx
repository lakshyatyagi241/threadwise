'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Facebook screens (one region, translated dismiss label). */
export function FacebookProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('facebook.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
