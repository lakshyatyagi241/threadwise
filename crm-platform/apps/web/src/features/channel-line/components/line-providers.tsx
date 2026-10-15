'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the LINE screens (one region, translated dismiss label). */
export function LineProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('line.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
