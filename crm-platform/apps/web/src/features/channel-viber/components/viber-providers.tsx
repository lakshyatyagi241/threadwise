'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Viber screens (one region, translated dismiss label). */
export function ViberProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('viber.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
