'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Alert } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { CostCard } from './cost-card';
import { OVERVIEW_KEY, overviewSchema } from './queries';
import { RunsCard } from './runs-card';
import { SettingsCard } from './settings-card';
import { ErrorBlock, LoadingBlock } from './state';
import { StatusStrip } from './status-strip';
import { WorkspacesCard } from './workspaces-card';

const NS = 'lead-scoring-admin.page';

/** The platform operator's AI lead scoring: status strip, settings, cost, per-workspace table and the run log. Super admins only. */
export function LeadScoringPage() {
  const t = useTranslations(NS);
  const { operator } = useOperator();
  const isSuper = operator.role === 'super_admin';
  const q = useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: ({ signal }) => operatorFetch('/lead-scoring', { schema: overviewSchema, signal }),
    enabled: isSuper,
    refetchOnWindowFocus: false,
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
            <CostCard overview={q.data} />
          </div>
          <WorkspacesCard />
          <RunsCard />
        </>
      ) : null}
    </div>
  );
}
