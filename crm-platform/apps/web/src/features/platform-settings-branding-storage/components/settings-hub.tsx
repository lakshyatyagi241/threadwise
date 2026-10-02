'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { setExportResponseSchema, setHubResponseSchema } from '@crm/contracts';
import { Badge, Button, Card, Spinner, StatTile } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { GROUP_SPECS } from '../fields';
import { exportFileName } from '../lib/export-name';
import { hubKey } from '../lib/query-keys';

const NS = 'platform-settings-branding-storage';

export function SettingsHubPage() {
  const t = useTranslations(NS);
  const tn = useTranslations(`${NS}.hub`);
  const format = useFormatter();
  const toast = useToast();
  const { operator } = useOperator();
  const q = useQuery({
    queryKey: hubKey,
    queryFn: ({ signal }) =>
      operatorFetch('/settings/groups', { schema: setHubResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });

  const exporting = useMutation({
    mutationFn: () => operatorFetch('/settings/export', { schema: setExportResponseSchema }),
    onSuccess: (out) => {
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = exportFileName(out.app, new Date(out.exportedAt));
      a.click();
      URL.revokeObjectURL(href);
    },
    onError: () => toast.error(t('common.unexpected')),
  });

  if (q.isPending) {
    return (
      <LoadingBlock className="flex min-h-64 items-center justify-center text-muted-foreground" />
    );
  }
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const { kpis, groups } = q.data;
  const state = new Map(groups.map((g) => [g.group, g]));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tn('kicker')}
        title={tn('title')}
        description={tn('description')}
        actions={
          operator.role === 'super_admin' ? (
            <Button
              variant="secondary"
              onClick={() => exporting.mutate()}
              disabled={exporting.isPending}
            >
              {exporting.isPending && <Spinner label={tn('exporting')} />}
              {exporting.isPending ? tn('exporting') : tn('export')}
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={tn('tiles.saved')}
          value={kpis.savedGroups}
          hint={tn('tiles.savedHint', { total: kpis.totalGroups })}
        />
        <StatTile
          label={tn('tiles.secrets')}
          value={kpis.secretFields}
          hint={tn('tiles.secretsHint')}
        />
        <StatTile
          label={tn('tiles.needsTest')}
          value={kpis.needsTest.length}
          tone={kpis.needsTest.length > 0 ? 'warning' : 'default'}
          hint={
            kpis.needsTest.length > 0
              ? kpis.needsTest.map((g) => t(`groups.${g}.title`)).join(', ')
              : tn('tiles.needsTestNone')
          }
        />
        <StatTile
          label={tn('tiles.lastUpdated')}
          value={
            <span className="text-lg">
              {kpis.lastUpdatedAt
                ? format.relativeTime(new Date(kpis.lastUpdatedAt))
                : tn('tiles.lastUpdatedNone')}
            </span>
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {GROUP_SPECS.map((spec) => {
          const s = state.get(spec.group);
          return (
            <Link
              key={spec.group}
              href={`/admin/settings/${spec.slug}`}
              className="rounded-md focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Card className="h-full space-y-2 transition-colors hover:border-primary/50">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold leading-tight">
                    {t(`groups.${spec.group}.title`)}
                  </h2>
                  {s?.needsTest ? (
                    <Badge tone="warning">{tn('card.needsTest')}</Badge>
                  ) : (
                    <Badge tone={s?.saved ? 'success' : 'neutral'}>
                      {s?.saved ? tn('card.saved') : tn('card.defaults')}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t(`groups.${spec.group}.description`)}
                </p>
                {s?.updatedAt && (
                  <p className="text-xs text-muted-foreground">
                    {tn('card.updated', { when: format.relativeTime(new Date(s.updatedAt)) })}
                  </p>
                )}
              </Card>
            </Link>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">{tn('others')}</p>
    </div>
  );
}
