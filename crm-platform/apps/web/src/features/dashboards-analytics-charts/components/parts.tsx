'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { DashFunnel } from '@crm/contracts';
import { PLAN_UPGRADE_PATH } from '@crm/contracts';
import { Alert, Card, cn } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { compact, directionOf, isGood, signed } from '../lib/format';

/** A change against the previous window: arrow, size, and green or red by whether it is good news. */
export function Trend({
  delta,
  unit = '%',
  lowerIsBetter = false,
}: {
  delta: number;
  unit?: '%' | 'pp';
  lowerIsBetter?: boolean;
}) {
  const dir = directionOf(delta);
  const good = isGood(delta, lowerIsBetter);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        good === null
          ? 'bg-muted text-muted-foreground'
          : good
            ? 'bg-success/10 text-success'
            : 'bg-danger/10 text-danger',
      )}
    >
      <span aria-hidden>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'}</span>
      {signed(delta, unit)}
    </span>
  );
}

/** Wraps a chart or list in a titled card. */
export function Panel({
  title,
  titleBadge,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  titleBadge?: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('space-y-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            {titleBadge}
          </div>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

const STAGE_KEYS = ['sent', 'delivered', 'replied', 'engaged'] as const;

/** Sent, delivered, replied, engaged: count, share of sent, drop from the stage before, and the end-to-end share. */
export function Funnel({
  funnel,
  previousEndToEnd,
}: {
  funnel: DashFunnel;
  previousEndToEnd?: number;
}) {
  const t = useTranslations('dashboards-analytics-charts.funnel');
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {funnel.stages.map((s, i) => (
          <li key={s.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>
                <span className="me-1.5 text-xs text-muted-foreground tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {t(`stage.${STAGE_KEYS[i]!}`)}
              </span>
              <span className="tabular-nums">
                <span className="font-medium">{compact(s.count)}</span>
                <span className="ms-2 text-xs text-muted-foreground">
                  {i === 0 ? '100%' : `${s.pct}%`}
                </span>
                {i > 0 && s.drop > 0 && (
                  <span className="ms-2 text-xs text-muted-foreground">
                    {t('drop', { n: compact(s.drop) })}
                  </span>
                )}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(s.count > 0 ? 2 : 0, s.pct))}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
      <p className="flex items-center justify-between border-t border-border pt-2 text-sm">
        <span className="text-muted-foreground">{t('endToEnd')}</span>
        <span className="flex items-center gap-2 tabular-nums">
          <strong>{funnel.endToEnd}%</strong>
          {previousEndToEnd !== undefined && (
            <Trend delta={Math.round((funnel.endToEnd - previousEndToEnd) * 10) / 10} unit="pp" />
          )}
        </span>
      </p>
    </div>
  );
}

/** The error of a screen: a plan that lacks the feature gets the upgrade note, a refused user the permission note. */
export function LoadError({ error }: { error: unknown }) {
  const t = useTranslations('dashboards-analytics-charts.error');
  const api = error instanceof ApiError ? error : null;
  if (api?.code === 'PLAN_FEATURE_LOCKED') {
    return (
      <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-2">
        <span>{t('locked')}</span>
        <Link href={PLAN_UPGRADE_PATH} className="font-medium underline">
          {t('upgrade')}
        </Link>
      </Alert>
    );
  }
  if (api?.status === 403) return <Alert tone="warning">{t('forbidden')}</Alert>;
  return <Alert tone="danger">{api?.message ?? t('generic')}</Alert>;
}
