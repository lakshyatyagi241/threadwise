'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** One frame for the /privacy-requests screens: the toasts. */
export function PrivacyShell({ children }: { children: ReactNode }) {
  const t = useTranslations('privacy-requests.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <div className="space-y-4">{children}</div>
    </ToastProvider>
  );
}
