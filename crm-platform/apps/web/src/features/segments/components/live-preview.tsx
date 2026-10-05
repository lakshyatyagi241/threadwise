'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Spinner, cn } from '@crm/ui';
import { contactDisplayName } from '@/features/contacts-attributes-tags';
import { previewRules } from '../api/segments';
import type { SegmentPreviewResponse, SegmentRules } from '../api/schemas';
import { ErrorLine } from './parts';
import { WarningIcon } from './icons';

/** `value`, but only after it has stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

export const PREVIEW_DELAY_MS = 600;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

function Sample({
  rows,
  stageLabel,
}: {
  rows: SegmentPreviewResponse['sample'];
  stageLabel: (value: string) => string;
}) {
  const t = useTranslations('segments.preview');
  return (
    <ul className="divide-y divide-border">
      {rows.map((c) => {
        const name = contactDisplayName(c) || t('unnamed');
        return (
          <li key={c.id} className="flex items-center gap-3 py-2">
            <span
              aria-hidden="true"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
            >
              {initials(name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{name}</div>
              <div className="truncate text-xs text-muted-foreground" dir="ltr">
                <span className="text-start">{c.email || c.phone || '-'}</span>
              </div>
            </div>
            {c.lifecycleStage && (
              <span className="hidden max-w-[7rem] truncate rounded-full border border-border px-2 py-0.5 text-[11px] sm:inline-block">
                {stageLabel(c.lifecycleStage)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The live preview beside the rule builder: how many contacts the rules match and ten of them. The call is made 600 ms
 * after the rules stop changing, on the complete conditions only; the last answer stays on screen (dimmed) while the next
 * one loads, so the panel never jumps.
 */
export function LivePreview({
  rules,
  incomplete,
  stageLabel,
  className,
}: {
  /** The rules the contract accepts, or null when there is nothing complete to count yet. */
  rules: SegmentRules | null;
  /** Conditions left out of `rules` because they are not finished. */
  incomplete: number;
  stageLabel: (value: string) => string;
  className?: string;
}) {
  const t = useTranslations('segments.preview');
  const key = rules ? JSON.stringify(rules) : '';
  const settled = useSettled(key, PREVIEW_DELAY_MS);
  const q = useQuery({
    queryKey: ['segments', 'preview', settled],
    queryFn: ({ signal }) => previewRules(JSON.parse(settled) as SegmentRules, signal),
    enabled: settled !== '',
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });
  const updating = key !== settled || (q.isFetching && !q.isPending);
  const data = settled !== '' ? q.data : undefined;

  return (
    <aside
      aria-label={t('title')}
      aria-busy={updating || q.isPending}
      className={cn('rounded-xl border border-border bg-background', className)}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <span
          aria-live="polite"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          {updating && (
            <>
              <Spinner label={t('updating')} />
              {t('updating')}
            </>
          )}
        </span>
      </header>
      <div className="p-4">
        {incomplete > 0 && (
          <Alert tone="info" className="mb-3 text-xs">
            {t('incomplete', { count: incomplete })}
          </Alert>
        )}

        {settled === '' && key === '' ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('idle')}</p>
        ) : q.isPending ? (
          <PreviewSkeleton label={t('loading')} />
        ) : q.isError && !data ? (
          <ErrorLine error={q.error} onRetry={() => void q.refetch()} />
        ) : data ? (
          <div className={cn('space-y-3 transition-opacity', updating && 'opacity-60')}>
            {q.isError && <ErrorLine error={q.error} onRetry={() => void q.refetch()} />}
            <div>
              <div className="text-3xl font-semibold tabular-nums">
                {data.countApproximate
                  ? t('about', { count: data.count })
                  : data.count.toLocaleString()}
              </div>
              <div className="text-sm text-muted-foreground">
                {t('matching', { count: data.count })}
              </div>
              {data.countApproximate && (
                <p className="mt-1 text-xs text-muted-foreground">{t('approximate')}</p>
              )}
            </div>
            {data.invalidConditions.length > 0 && (
              <Alert tone="warning" className="flex items-start gap-2 text-xs">
                <WarningIcon className="mt-0.5 size-3.5 shrink-0" />
                {t('invalid', { count: data.invalidConditions.length })}
              </Alert>
            )}
            {data.sample.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-6 text-center">
                <div className="text-sm font-medium">{t('emptyTitle')}</div>
                <p className="mt-1 text-xs text-muted-foreground">{t('empty')}</p>
              </div>
            ) : (
              <>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t('sample', { shown: data.sample.length, count: data.count })}
                </div>
                <Sample rows={data.sample} stageLabel={stageLabel} />
              </>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function PreviewSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="animate-pulse space-y-3">
      <div className="h-9 w-24 rounded bg-muted" />
      <div className="h-3 w-32 rounded bg-muted" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-1.5">
          <span className="size-8 rounded-full bg-muted" />
          <span className="h-3 w-40 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
