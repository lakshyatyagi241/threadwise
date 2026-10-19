'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { RETENTION_GROUPS, retentionOverviewSchema, type RetentionOverview } from '@crm/contracts';
import { Alert, Button, Card, Spinner } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { ItemRow } from './item-row';
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
    <div className="mx-auto max-w-[96rem] space-y-6">
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
      <Card className="overflow-x-auto p-0" data-testid="retention-table">
        <table className="w-full min-w-[66rem] border-collapse text-sm">
          <caption className="sr-only">{t('table.title')}</caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="px-0 py-2 ps-4 pe-3 text-start font-medium">
                {t('table.item')}
              </th>
              <th scope="col" className="py-2 pe-3 text-start font-medium">
                {t('fields.liveDays')}
              </th>
              <th scope="col" className="py-2 pe-3 text-start font-medium">
                {t('fields.archiveDays')}
              </th>
              <th scope="col" className="py-2 pe-3 text-start font-medium">
                {t('table.deleted')}
              </th>
              <th scope="col" className="py-2 pe-3 text-start font-medium">
                {t('stats.live')}
              </th>
              <th scope="col" className="py-2 pe-3 text-start font-medium">
                {t('stats.lastRun')}
              </th>
              <th scope="col" className="py-2 pe-3 text-start font-medium">
                {t('table.setting')}
              </th>
              <th scope="col" className="py-2 pe-4 text-start font-medium">
                <span className="sr-only">{t('table.actions')}</span>
              </th>
            </tr>
          </thead>
          {RETENTION_GROUPS.map((group) => {
            const items = q.data.items.filter((i) => i.group === group);
            if (items.length === 0) return null;
            return (
              <tbody key={group} data-testid={`retention-table-group-${group}`}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={8}
                    className="bg-muted/40 px-4 py-1.5 text-start font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    {t(`groups.${group}`)}
                  </th>
                </tr>
                {/* Remounted on every new version so a save, a reset or a conflict leaves the row showing what the server holds. */}
                {items.map((item) => (
                  <ItemRow
                    key={`${item.id}:${item.rowVersion ?? 0}:${item.source}`}
                    item={item}
                    canEdit={canEdit}
                    archiveDriver={q.data.engine.archiveDriver}
                  />
                ))}
              </tbody>
            );
          })}
        </table>
      </Card>
    </div>
  );
}
