'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PLAN_UPGRADE_PATH } from '@crm/contracts';
import { Alert, Card, cn } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { directionOf, isGood, signed } from '../lib/format';

/** A change against the previous window: arrow, size, and green or red by whether it is good news. */
export function Trend({
  delta,
  unit = '%',
  lowerIsBetter = false,
  downTone = 'danger',
}: {
  delta: number;
  unit?: '%' | 'pp';
  lowerIsBetter?: boolean;
  /** Colour of a move for the worse: red by default, amber where a drop is a nudge, not an alarm. */
  downTone?: 'danger' | 'warning';
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
            : downTone === 'warning'
              ? 'bg-warning/10 text-warning'
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
