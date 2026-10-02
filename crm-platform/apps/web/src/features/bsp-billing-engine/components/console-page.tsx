'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Spinner } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock } from '@/features/auth-registration-security/platform/ui/state';
import { KEYS, operatorApi } from '../api';
import { AttachCard } from './attach-card';
import { ConnectionCard } from './connection-card';
import { GuideCard } from './guide-card';
import { RegisterCard } from './register-card';

/** The operator's reseller page: connect Meta, attach credit lines, see every allocation. */
export function ConsolePage() {
  const t = useTranslations('bsp-billing-engine.console');
  const tc = useTranslations('bsp-billing-engine.common');
  const { canRunDanger } = useOperator();
  const q = useQuery({
    queryKey: KEYS.settings,
    queryFn: ({ signal }) => operatorApi.settings(signal),
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Link href="/admin/bsp">
            <Button variant="secondary" size="sm">
              {t('linkIncome')}
            </Button>
          </Link>
        }
      />
      {q.isPending ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground">
          <Spinner label={tc('loading')} />
          {tc('loading')}
        </div>
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <Alert tone="warning" className="space-y-0.5">
            <p className="font-medium">{t('optionalTitle')}</p>
            <p>{t('optionalBody')}</p>
          </Alert>
          {!canRunDanger && <Alert tone="info">{t('readOnly')}</Alert>}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-6">
              <ConnectionCard settings={q.data} canEdit={canRunDanger} />
              <AttachCard settings={q.data} canEdit={canRunDanger} />
              <RegisterCard canEdit={canRunDanger} />
            </div>
            <aside>
              <GuideCard />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
