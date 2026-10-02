'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { systemStatusResponseSchema } from '@crm/contracts';
import { Alert, Badge, Button, Card } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { checkTone, formatUptime, migrationStatusTone, rowTone } from './system-format';

const NS = 'install-update-licensing.system';

/** Read-only System page: release, setup lock, dependency checks and the migration ledger (WD-INST-019, -025, -027). */
export function SystemView() {
  const t = useTranslations(NS);
  const locale = useLocale();
  const q = useQuery({
    queryKey: ['operator', 'system'],
    queryFn: ({ signal }) =>
      operatorFetch('/system', { schema: systemStatusResponseSchema, signal }),
  });
  const when = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }),
    [locale],
  );
  const stamp = (iso: string | null) => (iso ? when.format(new Date(iso)) : t('release.none'));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void q.refetch()}
            disabled={q.isFetching}
          >
            {t('refresh')}
          </Button>
        }
      />
      {q.isPending && <LoadingBlock />}
      {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <>
          {q.data.release.demoMode && <Alert tone="warning">{t('release.demo')}</Alert>}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-3">
              <h2 className="text-base font-semibold">{t('release.title')}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t('release.version')}</dt>
                <dd className="font-mono">{q.data.release.version}</dd>
                <dt className="text-muted-foreground">{t('release.gitSha')}</dt>
                <dd className="font-mono">{q.data.release.gitSha ?? t('release.none')}</dd>
                <dt className="text-muted-foreground">{t('release.buildNumber')}</dt>
                <dd className="font-mono">{q.data.release.buildNumber ?? t('release.none')}</dd>
                <dt className="text-muted-foreground">{t('release.builtAt')}</dt>
                <dd>{stamp(q.data.release.builtAt)}</dd>
                <dt className="text-muted-foreground">{t('release.environment')}</dt>
                <dd>{q.data.release.environment}</dd>
                <dt className="text-muted-foreground">{t('release.uptime')}</dt>
                <dd>{formatUptime(q.data.uptimeSeconds)}</dd>
              </dl>
            </Card>

            <Card className="space-y-3">
              <h2 className="text-base font-semibold">{t('setup.title')}</h2>
              <Badge tone={q.data.setup.state === 'completed' ? 'success' : 'warning'}>
                {t(`setup.${q.data.setup.state}`)}
              </Badge>
              {q.data.setup.completedAt && (
                <p className="text-sm text-muted-foreground">
                  {t('setup.completedAt', {
                    date: stamp(q.data.setup.completedAt),
                    version: q.data.setup.completedVersion ?? t('release.none'),
                  })}
                </p>
              )}
            </Card>
          </div>

          <Card className="space-y-3">
            <h2 className="text-base font-semibold">{t('checks.title')}</h2>
            <ul className="grid gap-2 sm:grid-cols-3">
              {q.data.checks.map((c) => (
                <li
                  key={c.key}
                  className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
                >
                  <span>{t(`checks.${c.key}`)}</span>
                  <span className="flex items-center gap-2">
                    {c.latencyMs !== undefined && (
                      <span className="text-xs text-muted-foreground">
                        {t('checks.latency', { ms: c.latencyMs })}
                      </span>
                    )}
                    <Badge tone={checkTone(c.status)}>{t(`checks.${c.status}`)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{t('migrations.title')}</h2>
              <span className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t('migrations.summary', { count: q.data.migrations.appliedCount })}
                </span>
                <Badge tone={migrationStatusTone(q.data.migrations.status)}>
                  {t(`migrations.status.${q.data.migrations.status}`)}
                </Badge>
              </span>
            </div>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pe-3 text-start font-medium">{t('migrations.id')}</th>
                    <th className="py-1 pe-3 text-start font-medium">
                      {t('migrations.stateLabel')}
                    </th>
                    <th className="py-1 text-start font-medium">{t('migrations.appliedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.migrations.rows.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="py-1 pe-3 font-mono text-xs">{r.id}</td>
                      <td className="py-1 pe-3">
                        <Badge tone={rowTone(r.state)}>{t(`migrations.state.${r.state}`)}</Badge>
                      </td>
                      <td className="py-1">{r.appliedAt ? stamp(r.appliedAt) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
