'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Email templates screen (one region, translated dismiss label). */
export function EmailTemplatesProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('emailTemplates.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
