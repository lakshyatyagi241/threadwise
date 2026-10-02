'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the template screens (one region, translated dismiss label). */
export function TemplatesProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('message-templates.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
