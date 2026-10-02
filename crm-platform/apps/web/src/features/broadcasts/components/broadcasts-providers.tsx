'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the broadcast screens (one region, translated dismiss label). */
export function BroadcastsProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('broadcasts.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
