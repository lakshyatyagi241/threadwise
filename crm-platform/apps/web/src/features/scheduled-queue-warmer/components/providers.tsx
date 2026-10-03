'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the scheduled-message and warmer screens (one region, translated dismiss label). */
export function SchedProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('scheduled-queue-warmer.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
