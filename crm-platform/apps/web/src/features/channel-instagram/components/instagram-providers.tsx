'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Instagram screens (one region, translated dismiss label). */
export function InstagramProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('instagram.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
