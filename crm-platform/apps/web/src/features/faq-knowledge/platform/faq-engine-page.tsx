'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Alert } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { MaintenanceCard } from './maintenance-card';
import { pollInterval } from './logic';
import { OVERVIEW_KEY, overviewSchema } from './queries';
import { SettingsCard } from './settings-card';
import { ErrorBlock, LoadingBlock } from './state';
import { StatusStrip } from './status-strip';
import { WorkspacesCard } from './workspaces-card';

const NS = 'faq-knowledge-admin.page';

/** The platform operator's FAQ engine: status strip, settings, maintenance and the per-workspace table. Super admins only. */
export function FaqEnginePage() {
  const t = useTranslations(NS);
  const { operator } = useOperator();
  const isSuper = operator.role === 'super_admin';
  const q = useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: ({ signal }) => operatorFetch('/faq', { schema: overviewSchema, signal }),
    enabled: isSuper,
    refetchOnWindowFocus: false,
    // Every 5 seconds while vectors are waiting to be made, then it stops by itself.
    refetchInterval: (query) => pollInterval(query.state.data),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {!isSuper ? (
        <Alert tone="info">{t('superOnly')}</Alert>
      ) : q.isPending ? (
        <LoadingBlock />
      ) : q.isError && !q.data ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <>
          <StatusStrip overview={q.data} />
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <SettingsCard config={q.data.config} />
            <MaintenanceCard stats={q.data.stats} />
          </div>
          <WorkspacesCard />
        </>
      ) : null}
    </div>
  );
}
