'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';

/** Toast region of the workspace Team and Roles screens. */
export function WorkspaceRbacProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('roles-permissions-workspace.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
