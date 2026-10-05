'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsResponseSchema } from '@crm/contracts';
import { Button, Card, StatTile, cn } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKey } from '../lib/display';
import { downloadFrom, minutesLabel } from '../lib/format';

const NS = 'platform-support-desk';
const WINDOWS = [7, 30, 90, 365] as const;

/** Support reports (TW-SUPP-031, 032): window buttons, KPIs, volume bars, status mix, top agents, CSV. */
export function ReportsPage() {
  const t = useTranslations(`${NS}.reports`);
  const ts = useTranslations(`${NS}.status`);
  const te = useTranslations(`${NS}.errors`);
  const toast = useToast();
  const [days, setDays] = useState<number>(30);

  const q = useQuery({
    queryKey: ['support', 'operator', 'reports', days],
    queryFn: ({ signal }) =>
      operatorFetch('/support/reports', { query: { days }, schema: reportsResponseSchema, signal }),
  });
  const exportCsv = () =>
    downloadFrom('/api/platform/support/reports/export.csv', 'support-tickets.csv').catch((e) =>
      toast.error(te(errorKey(e))),
    );

  const d = q.data;
  const max = Math.max(1, ...(d?.volume.map((v) => v.count) ?? [1]));
  const statusTotal = Math.max(1, d?.byStatus.reduce((a, s) => a + s.count, 0) ?? 1);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('subtitle', { days })}
        actions={
          <>
            {WINDOWS.map((w) => (
              <Button
                key={w}
                size="sm"
                variant={days === w ? 'primary' : 'secondary'}
                aria-pressed={days === w}
                onClick={() => setDays(w)}
              >
                {t(`windows.${w}`)}
              </Button>
            ))}
            <Button variant="secondary" onClick={() => void exportCsv()}>
              {t('csv')}
            </Button>
          </>
        }
      />
      {q.isPending && <LoadingBlock />}
      {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
      {d && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label={t('kpi.tickets', { days })} value={d.kpis.tickets} />
            <StatTile label={t('kpi.resolved', { days })} value={d.kpis.resolved} tone="accent" />
            <StatTile
              label={t('kpi.avgFirst')}
              value={minutesLabel(d.kpis.avgFirstResponseMinutes)}
            />
            <StatTile label={t('kpi.avgRes')} value={minutesLabel(d.kpis.avgResolutionMinutes)} />
            <StatTile label={t('kpi.compliance')} value={`${d.kpis.compliance}%`} tone="warning" />
          </section>
          <section className="grid items-start gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="mb-4 text-lg font-semibold">{t('volume', { days })}</h2>
              {d.kpis.tickets === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t('noVolume', { days })}
                </p>
              ) : (
                <div
                  className="flex h-36 items-end gap-px"
                  role="img"
                  aria-label={t('volume', { days })}
                >
                  {d.volume.map((v) => (
                    <div
                      key={v.date}
                      title={`${v.date}: ${v.count}`}
                      className={cn('flex-1 rounded-sm', v.count ? 'bg-primary/80' : 'bg-muted')}
                      style={{ height: `${Math.max(4, Math.round((v.count / max) * 130))}px` }}
                    />
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <h2 className="mb-4 text-lg font-semibold">{t('byStatus')}</h2>
              {d.byStatus.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">{t('noStatus')}</p>
              )}
              <div className="space-y-2">
                {d.byStatus.map((s) => (
                  <div key={s.status}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">{ts(s.status)}</span>
                      <span className="font-mono">
                        {s.count} · {Math.round((s.count / statusTotal) * 100)}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${(s.count / statusTotal) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>
          <Card className="overflow-x-auto p-0">
            <h2 className="border-b px-5 py-4 text-lg font-semibold">{t('top', { days })}</h2>
            <table className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="p-3 text-start">{t('agent')}</th>
                  <th className="p-3 text-end">{t('resolvedCol')}</th>
                  <th className="p-3 text-end">{t('avgFirstCol')}</th>
                  <th className="p-3 text-end">{t('avgResCol')}</th>
                </tr>
              </thead>
              <tbody>
                {d.topAgents.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-muted-foreground">
                      {t('noTop')}
                    </td>
                  </tr>
                )}
                {d.topAgents.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="p-3 font-semibold">{a.name}</td>
                    <td className="p-3 text-end font-mono">{a.resolved}</td>
                    <td className="p-3 text-end font-mono">
                      {minutesLabel(a.avgFirstResponseMinutes)}
                    </td>
                    <td className="p-3 text-end font-mono">
                      {minutesLabel(a.avgResolutionMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
