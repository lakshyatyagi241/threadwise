'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the workspace AI screens (one region, translated dismiss label). */
export function AiProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('ai-keys-usage-admin.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
