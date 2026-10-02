'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the team-chat screen (one region, translated dismiss label). */
export function TeamChatProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('team-chat.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
