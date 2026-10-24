'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useApiLogApis } from '../api/hooks';
import { LogsIcon } from './icons';
import { PageHeader } from './page-chrome';
import { LogsPanel } from './logs-panel';
import { useUrlPaging } from './use-paging';

/** `/api-library/logs`: every run of every API in the workspace (tests and flows), with filters. */
export function LogsScreen() {
  const t = useTranslations('api-library.logs');
  const canRead = useCan('integ.apilibrary.read');
  // Every saved API and each deleted API that still has runs (a workspace holds at most 200 saved APIs); the filter needs nothing else.
  const logApis = useApiLogApis(canRead);
  const paging = useUrlPaging();
  if (!canRead) {
    return (
      <section className="max-w-none">
        <Alert tone="warning">{t('noAccess')}</Alert>
      </section>
    );
  }
  return (
    <section className="max-w-none space-y-4">
      <PageHeader
        icon={<LogsIcon className="size-5" />}
        title={t('title')}
        subtitle={t('subtitle')}
        back={{ href: '/api-library', label: t('back') }}
      />
      <LogsPanel paging={paging} apis={logApis.data?.data ?? []} />
    </section>
  );
}
