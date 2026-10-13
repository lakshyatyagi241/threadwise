'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, ConfirmDialog, EmptyState, Input, Select, Spinner, StatTile, cn } from '@crm/ui';
import { useClearNotifications } from '@/features/admin-console-shell/header/clear-notifications';
import { useMarkRead } from '../api/hooks';
import { NotificationRow, PREFERENCES_HREF } from '../components/notification-bell';
import { isKnownType, typeMeta, NOTIFICATION_GROUPS } from '../lib/catalogue';
import { useDismissNotification, useNotificationSummary, useNotificationsPage } from './hooks';
import {
  EMPTY_PAGE_FILTERS,
  groupByDay,
  isPageFiltered,
  parsePageFilters,
  toPageSearch,
  type PageFilters,
} from './model';

/**
 * The full Notifications page behind the bell's "View all" (TW-NOTIF-007, 008): the person's own notifications, newest first, in day
 * sections. Counts on top (unread, last day, last week, total), an All / Unread switch, a type filter, a text search (title and
 * text), Mark all read, dismiss one, Clear all. Filters live in the URL. It follows the live socket like the bell does.
 */
export function NotificationsPage() {
  const t = useTranslations('notifications.page');
  const tn = useTranslations('notifications');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(() => parsePageFilters(new URLSearchParams(params.toString())), [params]);
  const [draft, setDraft] = useState(filters.q);
  const [confirmClear, setConfirmClear] = useState(false);

  const summary = useNotificationSummary();
  const feed = useNotificationsPage(filters);
  const { markRead, markAllRead, markingAll } = useMarkRead();
  const clear = useClearNotifications();
  const dismiss = useDismissNotification();

  const go = useCallback(
    (next: PageFilters) => {
      const qs = toPageSearch(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // The search applies a moment after typing stops, like Reference's 220 ms debounce.
  useEffect(() => setDraft(filters.q), [filters.q]);
  useEffect(() => {
    const next = draft.trim();
    if (next === filters.q) return;
    const id = setTimeout(() => go({ ...filters, q: next }), 300);
    return () => clearTimeout(id);
  }, [draft, filters, go]);

  const rows = useMemo(() => feed.data?.pages.flatMap((p) => p.data) ?? [], [feed.data]);
  const sections = useMemo(() => groupByDay(rows, new Date()), [rows]);
  const unread = summary.data?.unread ?? feed.data?.pages[0]?.meta.unread ?? 0;
  const n = (v: number | undefined) => (v === undefined ? '-' : v.toLocaleString(locale));

  const typeOptions = useMemo(() => {
    const keys = Object.keys(summary.data?.byType ?? {});
    if (filters.type && !keys.includes(filters.type)) keys.push(filters.type);
    const groups: Array<{ id: string; known: boolean; types: string[] }> = NOTIFICATION_GROUPS.map(
      (group) => ({
        id: group,
        known: true,
        types: keys.filter((k) => isKnownType(k) && typeMeta(k).group === group).sort(),
      }),
    );
    // A type this build does not know yet (another domain started notifying) is still filterable, under "Other".
    groups.push({ id: 'other', known: false, types: keys.filter((k) => !isKnownType(k)).sort() });
    return groups.filter((g) => g.types.length > 0);
  }, [summary.data, filters.type]);
  const typeLabel = (type: string): string =>
    isKnownType(type) && tn.has(`prefs.types.${type}.label`)
      ? tn(`prefs.types.${type}.label`)
      : type;

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={unread === 0 || markingAll}
            onClick={() => markAllRead()}
          >
            {t('markAll')}
          </Button>
          <Button
            variant="ghost"
            disabled={(summary.data?.total ?? rows.length) === 0}
            onClick={() => setConfirmClear(true)}
          >
            {t('clearAll')}
          </Button>
          <Link
            href={PREFERENCES_HREF}
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('preferences')}
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          aria-pressed={filters.read === 'unread'}
          onClick={() => go({ ...filters, read: filters.read === 'unread' ? 'all' : 'unread' })}
          className={cn(
            'rounded-md text-start focus-visible:ring-2 focus-visible:ring-primary',
            filters.read === 'unread' && 'ring-2 ring-primary/40',
          )}
        >
          <StatTile
            label={t('tiles.unread')}
            value={n(summary.data?.unread)}
            hint={t('tiles.unreadHint')}
            tone="accent"
          />
        </button>
        <StatTile label={t('tiles.day')} value={n(summary.data?.last24Hours)} hint={t('tiles.dayHint')} />
        <StatTile label={t('tiles.week')} value={n(summary.data?.last7Days)} hint={t('tiles.weekHint')} />
        <StatTile label={t('tiles.total')} value={n(summary.data?.total)} hint={t('tiles.totalHint')} />
      </div>

      <div
        role="search"
        aria-label={t('filters.label')}
        className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
      >
        <div role="group" aria-label={t('filters.readLabel')} className="flex gap-1">
          {(['all', 'unread'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={filters.read === k}
              onClick={() => go({ ...filters, read: k })}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm transition focus-visible:ring-2 focus-visible:ring-primary',
                filters.read === k
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t(`filters.${k}`)}
            </button>
          ))}
        </div>
        <Select
          aria-label={t('filters.type')}
          className="h-9 w-auto max-w-full"
          value={filters.type}
          onChange={(e) => go({ ...filters, type: e.target.value })}
        >
          <option value="">{t('filters.allTypes')}</option>
          {typeOptions.map((g) => (
            <optgroup
              key={g.id}
              label={g.known ? tn(`prefs.groups.${g.id}`) : t('filters.otherTypes')}
            >
              {g.types.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(type)}
                  {summary.data?.byType[type] ? ` (${summary.data.byType[type]})` : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <div className="flex-1" />
        <Input
          type="search"
          value={draft}
          maxLength={100}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('filters.search')}
          aria-label={t('filters.search')}
          className="h-9 w-64 max-w-full"
        />
        {isPageFiltered(filters) && (
          <Button variant="ghost" size="sm" onClick={() => go({ ...EMPTY_PAGE_FILTERS })}>
            {t('filters.reset')}
          </Button>
        )}
      </div>

      {feed.isError ? (
        <div className="space-y-3" data-testid="notifications-error">
          <Alert tone="danger">{t('failed')}</Alert>
          <Button variant="secondary" onClick={() => void feed.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : feed.isPending ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Spinner label={t('loading')} />
          {t('loading')}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={isPageFiltered(filters) ? t('emptyFiltered') : t('empty')}
          message={isPageFiltered(filters) ? t('emptyFilteredHint') : t('emptyHint')}
          actions={
            isPageFiltered(filters) ? (
              <Button variant="secondary" onClick={() => go({ ...EMPTY_PAGE_FILTERS })}>
                {t('filters.reset')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-5">
          {sections.map((s) => (
            <section key={s.section} aria-labelledby={`notif-${s.section}`}>
              <h2
                id={`notif-${s.section}`}
                className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t(`sections.${s.section}`)}
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                {s.rows.map((row) => (
                  <li key={row.id} className="relative" data-testid="notification-item">
                    <div className="pe-12">
                      <NotificationRow
                        n={row}
                        onOpen={(x) => {
                          if (x.readAt === null) markRead(x.id);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => dismiss.mutate(row.id)}
                      disabled={dismiss.isPending}
                      aria-label={t('dismiss')}
                      title={t('dismiss')}
                      className="absolute end-2 top-2 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span aria-live="polite">{t('showing', { count: rows.length })}</span>
            {feed.hasNextPage ? (
              <Button
                variant="secondary"
                onClick={() => void feed.fetchNextPage()}
                disabled={feed.isFetchingNextPage}
              >
                {feed.isFetchingNextPage && <Spinner />}
                {t('loadMore')}
              </Button>
            ) : (
              <span>{t('end')}</span>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        tone="danger"
        title={t('clearTitle')}
        message={t('clearBody')}
        confirmLabel={t('clearConfirm')}
        cancelLabel={t('cancel')}
        busy={clear.isPending}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => clear.mutate(undefined, { onSettled: () => setConfirmClear(false) })}
      />
    </section>
  );
}
