'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the email screens (one region, translated dismiss label). */
export function EmailProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('email.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
