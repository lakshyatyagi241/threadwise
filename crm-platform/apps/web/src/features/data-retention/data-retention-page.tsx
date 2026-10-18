'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { retentionOverviewSchema, type RetentionOverview } from '@crm/contracts';
import { Alert, Button, Spinner } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { ItemCard } from './item-card';
import { errorKind } from './lib/errors';
import { DATA_RETENTION_QUERY_KEY } from './queries';

const NS = 'data-retention';

/** Which banner explains what the archive job will do with the values saved below. */
export function engineBanner(
  e: RetentionOverview['engine'],
): 'notDurable' | 'off' | 'dryRun' | 'live' {
  if (e.enabled && !e.dryRun && !e.archiveDurable) return 'notDurable';
  if (!e.enabled) return 'off';
  if (e.dryRun) return 'dryRun';
  return 'live';
}

/** The super admin's retention dashboard: one card per data item, with the two numbers an admin can change. */
export function DataRetentionPage() {
  const t = useTranslations(NS);
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const q = useQuery({
    queryKey: DATA_RETENTION_QUERY_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/data-retention', { schema: retentionOverviewSchema, signal }),
    refetchOnWindowFocus: false,
  });

  if (q.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner /> {t('page.loading')}
      </div>
    );
  }
  if (q.isError) {
    return (
      <Alert tone="danger" role="alert">
        <p>{t(`errors.${errorKind(q.error)}`)}</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => void q.refetch()}>
          {t('page.retry')}
        </Button>
      </Alert>
    );
  }

  const banner = engineBanner(q.data.engine);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('page.eyebrow')}
        </p>
        <h1 className="text-2xl font-semibold">{t('page.title')}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('page.description')}</p>
      </div>
      {!canEdit && <Alert tone="info">{t('page.superOnly')}</Alert>}
      <Alert
        tone={banner === 'live' ? 'info' : banner === 'notDurable' ? 'danger' : 'warning'}
        data-testid="engine-banner"
        data-state={banner}
      >
        <p className="font-semibold">{t(`engine.${banner}Title`)}</p>
        <p>
          {t(`engine.${banner}Body`, {
            driver: q.data.engine.archiveDriver === 's3' ? 'S3 / R2' : 'local',
          })}
        </p>
      </Alert>
      {/* Remounted on every new version so a save, a reset or a conflict leaves the form showing what the server holds. */}
      {q.data.items.map((item) => (
        <ItemCard
          key={`${item.id}:${item.rowVersion ?? 0}:${item.source}`}
          item={item}
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}
