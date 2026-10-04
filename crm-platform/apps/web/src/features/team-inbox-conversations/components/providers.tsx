'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';
import { CallingProvider, IncomingCallToast, OnCallPanel } from '@/features/calling-voice';

/** Toast host for the inbox screens (one region, translated dismiss label). */
export function InboxProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('team-inbox-conversations.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      {/* WhatsApp calling (WD-CALL-007, 012, 018): the incoming-call toast and the on-call panel live as long as the inbox does. */}
      <CallingProvider>
        <IncomingCallToast />
        <OnCallPanel />
        {children}
      </CallingProvider>
    </ToastProvider>
  );
}
