'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Developers console (one region, translated dismiss label). */
export function DeveloperProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('developer-rest-api-v1.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
