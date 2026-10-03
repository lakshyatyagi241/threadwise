'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the WABA screens (one region, translated dismiss label). */
export function WabaProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('whatsapp-cloud-api-waba.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
