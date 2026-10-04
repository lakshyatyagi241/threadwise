'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { platformAiKeysResponseSchema } from '@crm/contracts';
import { Alert, Card, StatTile } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '../shared/state';
import { KeyCard } from './key-card';
import { KEYS_QUERY_KEY } from './queries';

const NS = 'ai-keys-usage-admin.keys';

/** The platform's provider keys: a status strip and one card per vendor, in Reference's order. */
export function KeysPage() {
  const t = useTranslations(NS);
  const { operator } = useOperator();
  const isSuper = operator.role === 'super_admin';
  const q = useQuery({
    queryKey: KEYS_QUERY_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/ai-keys', { schema: platformAiKeysResponseSchema, signal }),
    enabled: isSuper,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {!isSuper ? (
        <Alert tone="info">{t('superOnly')}</Alert>
      ) : q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label={t('summary.providers')}
              value={q.data.summary.providers}
              hint={t('summary.providersHint')}
            />
            <StatTile
              label={t('summary.active')}
              value={q.data.summary.active}
              hint={t('summary.activeHint')}
            />
            <StatTile
              label={t('summary.ready')}
              value={q.data.summary.ready}
              hint={t('summary.readyHint')}
              tone="accent"
            />
            <StatTile
              label={t('summary.noKey')}
              value={q.data.summary.noKey}
              hint={t('summary.noKeyHint')}
              tone={q.data.summary.noKey > 0 ? 'warning' : 'default'}
            />
          </div>

          <div className="space-y-3">
            {q.data.data.map((item) => (
              <KeyCard key={`${item.id}:${item.rowVersion}`} item={item} />
            ))}
          </div>

          <Card className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('help.eyebrow')}
            </p>
            <h2 className="font-semibold">{t('help.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('help.body')}</p>
          </Card>
        </>
      )}
    </div>
  );
}
