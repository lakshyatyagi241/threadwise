'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** One frame for the /contact-consent screen: the toasts. */
export function ConsentShell({ children }: { children: ReactNode }) {
  const t = useTranslations('contact-consent.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <div className="space-y-4">{children}</div>
    </ToastProvider>
  );
}
