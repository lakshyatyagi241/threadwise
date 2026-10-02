'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the inbox screens (one region, translated dismiss label). */
export function InboxProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('team-inbox-conversations.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
