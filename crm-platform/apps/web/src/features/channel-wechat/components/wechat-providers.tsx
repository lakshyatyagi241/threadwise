'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast host for the WeChat screens (one region, translated dismiss label). */
export function WechatProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('wechat.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
