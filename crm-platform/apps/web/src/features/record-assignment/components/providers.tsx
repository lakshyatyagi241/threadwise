'use client';

import type { ReactNode } from 'react';
import { ToastProvider } from '@crm/ui';
import { useRa } from './use-ra';

/**
 * Toast host for Settings > Automation > Record assignment rules. The screen and its panels call `useToast()`, which throws without a
 * provider above it; this route group had none, so the page crashed into the app-wide error boundary on every workspace (the render
 * test wrapped the screen in its own provider and never saw it). One region, translated dismiss label, like every other domain.
 */
export function RecordAssignmentProviders({ children }: { children: ReactNode }) {
  const { t } = useRa();
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}
