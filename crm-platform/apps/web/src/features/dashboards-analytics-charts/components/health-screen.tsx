'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  clearQueueResponseSchema,
  healthResponseSchema,
  type HealthCheck,
  type HealthResponse,
  type HealthState,
} from '@crm/contracts';
import { Alert, Badge, Button, Card, ConfirmDialog, Spinner } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { Sparkline } from './charts';
import { diskToneOf, latencyBars, toneOf } from '../lib/health';

const NS = 'dashboards-analytics-charts.health';
/** Reference repaints the probe cards every 20 seconds. */
const POLL_MS = 20_000;
const KEY = ['operator', 'system-health'] as const;

const DOT: Record<HealthState, string> = {
  up: 'bg-success',
  warn: 'bg-warning',
  down: 'bg-danger',
  idle: 'bg-muted-foreground',
};
const BAR: Record<'success' | 'warning' | 'danger', string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/** The console's system health page (TW-DASH-048..051): banner, five probe cards, response times, queues and host vitals. */
export function HealthScreen() {
  const t = useTranslations(NS);
  const locale = useLocale();
  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => operatorFetch('/health', { schema: healthResponseSchema, signal }),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
  });

  if (q.isPending) {
    return (
      <div className="flex min-h-64 items-center justify-center text-muted-foreground">
        <Spinner label={t('banner.refreshing')} />
      </div>
    );
  }
  // Reference swallows a failed poll and keeps the last cards; so does this when data is already on screen.
  if (!q.data) {
    return (
      <Alert tone="danger" className="space-y-2">
        <p>{t('error')}</p>
        <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
          {t('banner.refresh')}
        </Button>
      </Alert>
    );
  }
  return (
    <Health
      data={q.data}
      fetching={q.isFetching}
      onRefresh={() => void q.refetch()}
      locale={locale}
    />
  );
}

function Health({
  data,
  fetching,
  onRefresh,
  locale,
}: {
  data: HealthResponse;
  fetching: boolean;
  onRefresh: () => void;
  locale: string;
}) {
  const t = useTranslations(NS);
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'medium' }).format(new Date(data.ts));
  const bars = latencyBars(data.checks);
  const peak = Math.max(0, ...data.throughput.map((p) => p.count));
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('kicker')}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
      </header>

      <Card
        className="flex flex-wrap items-center justify-between gap-3"
        data-testid="health-banner"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={`h-3 w-3 rounded-full ${DOT[data.overall]} ${data.overall === 'up' ? 'animate-pulse' : ''}`}
          />
          <div>
            <p className="font-medium">{t(`banner.${data.overall}`)}</p>
            <p className="text-xs text-muted-foreground">{t('banner.checked', { time })}</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={fetching}>
          {fetching ? t('banner.refreshing') : t('banner.refresh')}
        </Button>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="health-activity">
        {(['messages', 'aiCalls', 'conversations', 'webhooks'] as const).map((k) => (
          <Card key={k} className="space-y-1">
            <p className="font-mono text-2xl">{data.activity[k].toLocaleString(locale)}</p>
            <p className="text-xs text-muted-foreground">{t(`activity.${k}`)}</p>
          </Card>
        ))}
      </div>

      <section aria-labelledby="core-h" className="space-y-3">
        <h2
          id="core-h"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t('core')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.checks.map((c) => (
            <CheckCard key={c.key} check={c} />
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="font-medium">{t('latency.title')}</h2>
          {bars.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('latency.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {bars.map((b) => (
                <li key={b.key} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{t(`check.${b.key}`)}</span>
                    <span className="font-mono text-muted-foreground">
                      {t('latency.ms', { ms: b.ms })}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${DOT[b.state]}`}
                      style={{ width: `${b.width}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="space-y-3" data-testid="health-throughput">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-medium">{t('throughput.title')}</h2>
            {peak > 0 ? (
              <span className="font-mono text-xs text-muted-foreground">
                {t('throughput.peak', { n: peak })}
              </span>
            ) : null}
          </div>
          {peak > 0 ? (
            <Sparkline values={data.throughput.map((p) => p.count)} label={t('throughput.aria')} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('throughput.empty')}</p>
          )}
        </Card>
      </div>

      <Engines engines={data.engines} />

      <Vitals v={data.vitals} />

      <QueueTable data={data} />
    </div>
  );
}

function CheckCard({ check }: { check: HealthCheck }) {
  const t = useTranslations(NS);
  return (
    <Card className="space-y-1" data-testid={`check-${check.key}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t(`check.${check.key}`)}</p>
        <Badge tone={toneOf(check.state)}>{t(`state.${check.state}`)}</Badge>
      </div>
      <p className="font-mono text-lg">{check.value}</p>
      <p className="text-xs text-muted-foreground">{check.detail}</p>
    </Card>
  );
}

/** TW-DASH-050: one card per WhatsApp engine; the dot never changes the banner. */
function Engines({ engines }: { engines: HealthResponse['engines'] }) {
  const t = useTranslations(NS);
  return (
    <section aria-label={t('engines.title')} className="space-y-3" data-testid="health-engines">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('engines.title')}
      </p>
      {engines.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t('engines.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {engines.map((e) => (
            <Card key={e.key} className="space-y-1" data-testid={`engine-${e.key}`}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{e.label}</p>
                <span
                  role="img"
                  aria-label={t(`state.${e.state}`)}
                  className={`size-2.5 rounded-full ${DOT[e.state]}`}
                />
              </div>
              <p className="font-serif text-[26px] leading-none">
                {e.connected}
                <span className="text-sm text-muted-foreground"> / {e.total}</span>
              </p>
              <p className="text-xs text-muted-foreground">{t('engines.caption')}</p>
              {e.breakdown.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {e.breakdown.map((b) => (
                    <span
                      key={b.status}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px]"
                    >
                      {b.status} {b.count}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function Vitals({ v }: { v: HealthResponse['vitals'] }) {
  const t = useTranslations(NS);
  const rows: Array<[string, string]> = [
    [t('vitals.node'), v.nodeVersion],
    [t('vitals.app'), v.appVersion],
    [t('vitals.environment'), v.environment],
    [t('vitals.uptime'), formatUptime(v.uptimeSeconds)],
    [t('vitals.memory'), `${v.memoryRssMb} MB`],
    [t('vitals.heap'), `${v.memoryHeapMb} MB`],
    [
      t('vitals.diskFree'),
      v.diskFreeGb === null ? t('vitals.noDisk') : t('vitals.diskFreeValue', { gb: v.diskFreeGb }),
    ],
  ];
  return (
    <Card className="space-y-3">
      <h2 className="font-medium">{t('vitals.title')}</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
        {rows.map(([k, val]) => (
          <div key={k}>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {k}
            </dt>
            <dd className="mt-1 font-mono">{val}</dd>
          </div>
        ))}
      </dl>
      {v.diskUsedPct !== null && (
        <div className="space-y-1">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={v.diskUsedPct}
            aria-label={t('vitals.diskUsed', { pct: v.diskUsedPct })}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={`h-full ${BAR[diskToneOf(v.diskUsedPct)]}`}
              style={{ width: `${v.diskUsedPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('vitals.diskUsed', { pct: v.diskUsedPct })}
          </p>
        </div>
      )}
    </Card>
  );
}

function QueueTable({ data }: { data: HealthResponse }) {
  const t = useTranslations(NS);
  const { canRunDanger } = useOperator();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const clear = useMutation({
    mutationFn: () =>
      operatorFetch('/health/clear-queue', {
        method: 'POST',
        body: {},
        schema: clearQueueResponseSchema,
      }),
    onSuccess: (r) => {
      setOpen(false);
      setResult({
        ok: true,
        text: t('clear.done', { pending: r.clearedPending, failed: r.clearedFailed }),
      });
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (err) => {
      setOpen(false);
      setResult({
        ok: false,
        text: t('clear.failed', { message: err instanceof Error ? err.message : String(err) }),
      });
    },
  });

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{t('queues.title')}</h2>
        {canRunDanger ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpen(true)}
            disabled={clear.isPending}
          >
            {clear.isPending ? t('clear.busy') : t('clear.button')}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{t('clear.superOnly')}</p>
        )}
      </div>
      {result && <Alert tone={result.ok ? 'success' : 'danger'}>{result.text}</Alert>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-muted-foreground">
              <th className="py-1 pe-4 text-start font-medium">{t('queues.name')}</th>
              <th className="py-1 pe-4 text-end font-medium">{t('queues.pending')}</th>
              <th className="py-1 text-end font-medium">{t('queues.failed')}</th>
            </tr>
          </thead>
          <tbody>
            {data.queues.map((r) => (
              <tr key={r.name} className="border-t border-border">
                <td className="py-1 pe-4 font-mono">{r.name}</td>
                <td className="py-1 pe-4 text-end font-mono">{r.pending}</td>
                <td className="py-1 text-end font-mono">{r.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={open}
        title={t('clear.confirmTitle')}
        message={t('clear.confirmBody')}
        confirmLabel={t('clear.confirm')}
        cancelLabel={t('clear.cancel')}
        tone="danger"
        busy={clear.isPending}
        onConfirm={() => clear.mutate()}
        onClose={() => setOpen(false)}
      />
    </Card>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${seconds % 60}s`;
}
