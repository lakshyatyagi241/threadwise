'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the personal-number screens (one region, translated dismiss label). */
export function DevicesProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('whatsapp-devices-baileys.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
