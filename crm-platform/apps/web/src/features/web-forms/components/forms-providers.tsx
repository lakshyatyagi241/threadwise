'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the Forms screens (one region, translated dismiss label). */
export function FormsProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('web-forms.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
