'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Alert, Button, ToastProvider, cn } from '@crm/ui';
import type { Segment, SegmentVisibility } from '../api/schemas';
import { errorKind } from '../lib/errors';
import { countState } from '../lib/hub';
import { shareSummary } from '../lib/share';
import {
  FunnelIcon,
  GroupIcon,
  LockIcon,
  RefreshIcon,
  UserCheckIcon,
  UsersIcon,
  WarningIcon,
} from './icons';

/** Toast host for every screen of the domain (one region, translated dismiss label). */
export function SegmentProviders({ children }: { children: ReactNode }) {
  const t = useTranslations('segments.common');
  return <ToastProvider dismissLabel={t('dismiss')}>{children}</ToastProvider>;
}

/** The colour dot of a segment (its accent), a funnel tile when none was chosen. */
export function ColorDot({
  color,
  className,
}: {
  color: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ background: color || 'var(--primary)' }}
    />
  );
}

/**
 * Private (lock), Shared (people) or Specific people (a person with a tick, and how many): an outlined chip so the three
 * read apart at a glance. A specific one lists the first names in its tooltip and for assistive technology.
 */
export function VisibilityChip({
  visibility,
  sharedWith,
}: {
  visibility: SegmentVisibility;
  sharedWith?: Segment['sharedWith'];
}) {
  const t = useTranslations('segments.visibility');
  const specific = visibility === 'specific';
  const summary = specific && sharedWith ? shareSummary(sharedWith) : null;
  const names = summary
    ? summary.names.join(', ') + (summary.more > 0 ? t('andMore', { count: summary.more }) : '')
    : '';
  const title = summary
    ? summary.count === 0
      ? t('specificNobody')
      : t('specificTitle', { names })
    : t(visibility === 'shared' ? 'sharedHint' : 'privateHint');
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium"
    >
      {visibility === 'private' ? (
        <LockIcon className="size-3" />
      ) : visibility === 'shared' ? (
        <UsersIcon className="size-3" />
      ) : (
        <UserCheckIcon className="size-3" />
      )}
      {specific ? t('specificCount', { count: summary?.count ?? 0 }) : t(visibility)}
      {summary && summary.count > 0 && <span className="sr-only">{`: ${names}`}</span>}
    </span>
  );
}

/** "3 conditions point at something deleted": the segment still works but matches less than it says. */
export function AttentionChip({ count }: { count: number }) {
  const t = useTranslations('segments.hub');
  return (
    <span
      title={t('attentionHint')}
      className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
    >
      <WarningIcon className="size-3" />
      {t('attention', { count })}
    </span>
  );
}

/**
 * A member count: "1,204", "about 12,000" when the server could only estimate, "-" before the first count. The icon
 * recounts now (the server rate limits it); the tooltip says when the number was worked out.
 */
export function MemberCount({
  segment,
  onRefresh,
  refreshing,
  size = 'sm',
}: {
  segment: Pick<Segment, 'memberCount' | 'countApproximate' | 'memberCountAt'>;
  /** Absent: the count is shown without a recount button (the person cannot do it). */
  onRefresh?: () => void;
  refreshing?: boolean;
  size?: 'sm' | 'lg';
}) {
  const t = useTranslations('segments.count');
  const format = useFormatter();
  const state = countState(segment);
  const counted = segment.memberCountAt
    ? t('countedAt', { when: format.relativeTime(new Date(segment.memberCountAt), new Date()) })
    : t('notCounted');
  return (
    <span className="inline-flex items-center gap-1.5" title={counted}>
      <span className={cn('font-semibold tabular-nums', size === 'lg' ? 'text-2xl' : 'text-sm')}>
        {state.kind === 'unknown'
          ? '-'
          : state.kind === 'approximate'
            ? t('about', { count: state.count })
            : state.count.toLocaleString()}
      </span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={t('refresh')}
          title={t('refresh')}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          <RefreshIcon className={cn('size-3.5', refreshing && 'animate-spin')} />
        </button>
      )}
    </span>
  );
}

/** A failed call in our words (chosen by error code) plus the request id, with a retry for reads. */
export function ErrorLine({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations('segments.errors');
  const kind = errorKind(error);
  return (
    <Alert tone={kind === 'unavailable' ? 'warning' : 'danger'} className={className}>
      <span>{t(kind)}</span>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

/** The one explanation of Group vs Segment, used by the hub's empty state and the builder. */
export function GroupVsSegment({ className }: { className?: string }) {
  const t = useTranslations('segments.help');
  return (
    <div className={cn('grid gap-3 text-sm sm:grid-cols-2', className)}>
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-center gap-2 font-semibold">
          <GroupIcon className="size-4 text-muted-foreground" />
          {t('groupTitle')}
        </div>
        <p className="mt-1.5 text-muted-foreground">{t('groupBody')}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">{t('groupExample')}</p>
      </div>
      <div className="rounded-lg border border-brand/40 bg-brand/5 p-3">
        <div className="flex items-center gap-2 font-semibold">
          <FunnelIcon className="size-4 text-brand" />
          {t('segmentTitle')}
        </div>
        <p className="mt-1.5 text-muted-foreground">{t('segmentBody')}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">{t('segmentExample')}</p>
      </div>
    </div>
  );
}
