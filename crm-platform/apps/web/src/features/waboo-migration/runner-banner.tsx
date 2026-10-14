'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import { useRunnerStatus } from './queries';

/**
 * Is the runner agent connected? Migrations run on a machine that is on the Geta VPN (the only place Waboo's database answers); this
 * says whether that machine is up, so an operator does not start a run that would only wait and fail. Nothing shows when the worker
 * runs the pipeline itself.
 */
export function RunnerBanner() {
  const t = useTranslations('waboo-migration-runner');
  const runner = useRunnerStatus();
  if (runner.data?.mode !== 'remote') return null;
  return runner.data.online ? (
    <Alert tone="info">{t('online', { name: runner.data.name ?? '' })}</Alert>
  ) : (
    <Alert tone="warning">{t('offline')}</Alert>
  );
}
