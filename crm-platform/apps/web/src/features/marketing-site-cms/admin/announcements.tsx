'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  announcementListResponseSchema,
  announcementSchema,
  type Announcement,
  type AnnouncementTone,
} from '@crm/contracts';
import { Button, ConfirmDialog, Input, StatTile, Switch } from '@crm/ui';
import {
  ActionError,
  ErrorBlock,
  LoadingBlock,
  NS,
  PageHeader,
  operatorFetch,
  PILL_BTN,
  PILL_DANGER,
} from './shared';

export const ANNOUNCEMENTS_KEY = ['operator', 'cms', 'announcements'];
const FILTERS = ['all', 'active', 'inactive', 'expired'] as const;
const FILTER_KEY = {
  all: 'filterAll',
  active: 'filterLive',
  inactive: 'filterDisabled',
  expired: 'filterExpired',
} as const;

/** The pill colours of Reference's tone chip (Info dark ink, Promo dark wood, Warning amber, Success green). */
export const TONE_CHIP: Record<AnnouncementTone, { bg: string; fg: string }> = {
  info: { bg: '#0b1f1c', fg: '#fbfaf6' },
  promo: { bg: '#4a3322', fg: '#fbfaf6' },
  warning: { bg: '#e5a04e', fg: '#0b1f1c' },
  success: { bg: '#128c7e', fg: '#ffffff' },
};

/**
 * The marquee announcements list (TW-CMS-039, 041): four tiles, the All / Live now / Disabled / Expired pills, search,
 * the table with a switch per row and a delete. Pages are cursor-based, so the footer says "Load more", not page links.
 */
export function Announcements() {
  const t = useTranslations(`${NS}.announcements`);
  const tc = useTranslations(`${NS}.common`);
  const locale = useLocale();
  const timeZone = useTimeZone();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('all');
  const [doomed, setDoomed] = useState<Announcement | null>(null);
  const q = term.trim();

  const list = useInfiniteQuery({
    queryKey: [...ANNOUNCEMENTS_KEY, { q, status }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      operatorFetch('/cms/announcements', {
        query: { q, status, cursor: pageParam },
        schema: announcementListResponseSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const summary = list.data?.pages[0]?.summary;
  const rel = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), [locale]);
  const day = useMemo(
    () => new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' }),
    [locale, timeZone],
  );
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const toggle = useMutation({
    mutationFn: (a: Announcement) =>
      operatorFetch(`/cms/announcements/${a.id}/toggle`, {
        method: 'POST',
        body: { rowVersion: a.rowVersion },
        schema: announcementSchema,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ANNOUNCEMENTS_KEY }),
  });
  const remove = useMutation({
    mutationFn: (a: Announcement) =>
      operatorFetch(`/cms/announcements/${a.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDoomed(null);
      return qc.invalidateQueries({ queryKey: ANNOUNCEMENTS_KEY });
    },
  });

  /** "starts in 3 days" / "expired 2 days ago" / "until Jan 5, 2030" / "forever" (the Window column). */
  const windowText = (a: Announcement): string => {
    const days = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
    if (a.status === 'scheduled' && a.startsAt)
      return t('startsIn', { when: rel.format(days(a.startsAt), 'day') });
    if (a.status === 'expired' && a.expiresAt)
      return t('expiredAgo', { when: rel.format(days(a.expiresAt), 'day') });
    if (a.expiresAt) return t('until', { date: day.format(new Date(a.expiresAt)) });
    return t('forever');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href="/admin/announcements/new"
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
          >
            {t('new')}
          </Link>
        }
      />
      {summary && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t('stats')}>
          <StatTile label={t('total')} value={nf.format(summary.total)} hint={t('totalHint')} />
          <StatTile
            label={t('live')}
            value={nf.format(summary.live)}
            hint={t('liveHint')}
            tone="accent"
          />
          <StatTile
            label={t('scheduled')}
            value={nf.format(summary.scheduled)}
            hint={t('scheduledHint')}
            tone="warning"
          />
          <StatTile
            label={t('expired')}
            value={nf.format(summary.expired)}
            hint={t('expiredHint')}
            tone="warning"
          />
        </section>
      )}
      <div
        role="search"
        className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
      >
        <div role="group" aria-label={t('filters')} className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={status === f}
              onClick={() => setStatus(f)}
              className={
                status === f
                  ? 'rounded-full bg-foreground px-4 py-1.5 text-sm text-background'
                  : 'rounded-full px-4 py-1.5 text-sm text-muted-foreground hover:bg-muted'
              }
            >
              {t(FILTER_KEY[f])}
            </button>
          ))}
        </div>
        <Input
          className="ms-auto w-full sm:w-72"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
        />
      </div>

      <ActionError error={toggle.error ?? remove.error} />
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t('colOrder')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('colMessage')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('colTone')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('colWindow')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('colActive')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center">
                    <p className="text-lg font-semibold">{t('empty')}</p>
                    <Link href="/admin/announcements/new" className="text-sm underline">
                      {t('emptyCta')}
                    </Link>
                  </td>
                </tr>
              )}
              {rows.map((a) => {
                const chip = TONE_CHIP[a.tone];
                return (
                  <tr key={a.id}>
                    <td className="px-4 py-3 tabular-nums">{a.sortOrder}</td>
                    <td className="max-w-md px-4 py-3">
                      <p className="font-medium">{a.text}</p>
                      {a.linkUrl && (
                        <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
                          → {a.linkUrl}
                          {a.linkLabel ? ` (${a.linkLabel})` : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{ background: chip.bg, color: chip.fg }}
                      >
                        {t(`tone_${a.tone}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{windowText(a)}</td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={a.isActive}
                        label={t('colActive')}
                        disabled={toggle.isPending}
                        onCheckedChange={() => toggle.mutate(a)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Link href={`/admin/announcements/${a.id}`} className={PILL_BTN}>
                          {tc('edit')}
                        </Link>
                        <button type="button" className={PILL_DANGER} onClick={() => setDoomed(a)}>
                          {tc('delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{summary ? t('showing', { shown: rows.length, total: summary.total }) : ''}</span>
        {list.hasNextPage && (
          <Button
            variant="secondary"
            onClick={() => void list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
          >
            {tc('loadMore')}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={doomed !== null}
        title={t('deleteTitle')}
        message={t('deleteMessage')}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => doomed && remove.mutate(doomed)}
        onClose={() => setDoomed(null)}
      />
    </div>
  );
}
