'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  OPERATOR_NOTIFICATION_TYPES,
  operatorNotificationsQuerySchema,
  type OperatorNotificationType,
} from '@crm/contracts';
import { Alert, Badge, Button, EmptyState, Spinner, StatTile, cn } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { timeAgo } from './header-logic';
import { useNotificationsPage } from './api';
import { useHeadline } from './use-headline';

const TYPE_TONE = {
  signup: 'neutral',
  payment: 'success',
  ticket: 'warning',
  contact: 'neutral',
  workspace: 'neutral',
} as const;

/**
 * TW-ASHELL-006, the page behind "View all" (`/admin/notifications`): KPI strip of the last 30 days that doubles as the
 * type filter, filter pills, a search box, and the event table, newest first. Opening it marks everything seen.
 */
export function NotificationsPage() {
  const t = useTranslations('admin-console-shell.notificationsPage');
  const tb = useTranslations('admin-console-shell.header.bell');
  const headline = useHeadline();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const parsed = operatorNotificationsQuerySchema.safeParse({
    type: params.get('type') ?? undefined,
    q: params.get('q') ?? undefined,
  });
  // An unknown type in the URL shows everything, like Reference.
  const query = parsed.success ? parsed.data : { type: 'all' as const };
  const [draft, setDraft] = useState(query.q ?? '');
  const feed = useNotificationsPage(query);

  const go = (type: string, q?: string) => {
    const next = new URLSearchParams();
    if (type !== 'all') next.set('type', type);
    if (q) next.set('q', q);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const stats = feed.data?.stats;
  const tiles: Array<{
    key: 'all' | OperatorNotificationType;
    tone: 'default' | 'accent' | 'warning';
  }> = [
    { key: 'all', tone: 'default' },
    { key: 'signup', tone: 'default' },
    { key: 'payment', tone: 'accent' },
    { key: 'ticket', tone: 'warning' },
    { key: 'contact', tone: 'default' },
    { key: 'workspace', tone: 'default' },
  ];

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">{t('eyebrow')}</p>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('note')}</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            void operatorFetch('/notifications/read-all', { method: 'POST' })
              .then(() => feed.refetch())
              .catch(() => undefined);
          }}
        >
          {tb('markAllRead')}
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(({ key, tone }) => (
          <Link
            key={key}
            href={key === 'all' ? pathname : `${pathname}?type=${key}`}
            aria-current={query.type === key ? 'true' : undefined}
            className={cn(
              'rounded-md focus-visible:ring-2 focus-visible:ring-primary',
              query.type === key && 'ring-2 ring-primary/40',
            )}
          >
            <StatTile
              label={t(`tiles.${key}`)}
              value={
                stats ? (key === 'all' ? stats.total : stats[key]).toLocaleString(locale) : '-'
              }
              hint={t('last30')}
              tone={tone}
            />
          </Link>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(query.type, draft.trim());
        }}
        className="flex flex-wrap items-center gap-1 rounded-md border border-border p-2"
      >
        {(['all', ...OPERATOR_NOTIFICATION_TYPES] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={query.type === k}
            onClick={() => go(k, draft.trim())}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm transition focus-visible:ring-2 focus-visible:ring-primary',
              query.type === k
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t(`pills.${k}`)}
          </button>
        ))}
        <div className="flex-1" />
        <input
          type="search"
          name="q"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="h-8 w-64 max-w-full rounded-full border border-border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary"
        />
      </form>

      {feed.isError ? (
        <Alert tone="danger">{t('loadFailed')}</Alert>
      ) : feed.isPending ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Spinner label={tb('loading')} />
          {tb('loading')}
        </div>
      ) : feed.data.items.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border bg-muted text-start text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium">
                    {t('cols.type')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">
                    {t('cols.event')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">
                    {t('cols.detail')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-end font-medium">
                    {t('cols.when')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-center font-medium">
                    {t('cols.open')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {feed.data.items.map((n) => (
                  <tr key={n.id} data-testid="event-row" className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <Badge tone={TYPE_TONE[n.type]}>{t(`kinds.${n.type}`)}</Badge>
                    </td>
                    <td className="px-3 py-3 font-semibold">{headline(n)}</td>
                    <td className="max-w-xs truncate px-3 py-3 text-muted-foreground">
                      {n.message ?? '-'}
                    </td>
                    <td className="px-3 py-3 text-end text-xs text-muted-foreground">
                      {timeAgo(n.at, feed.dataUpdatedAt, locale)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Link
                        href={n.actionUrl}
                        title={t('cols.open')}
                        aria-label={`${t('cols.open')}: ${headline(n)}`}
                        className="inline-flex size-7 items-center justify-center rounded-md border border-border hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 16 16"
                          className="size-3.5 rtl:-scale-x-100"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3 8h10M9 4l4 4-4 4"
                          />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
            <span>
              {t('showing', { count: feed.data.items.length })}
              {query.type !== 'all' ? ` · ${t(`pills.${query.type}`)}` : ''}
            </span>
            <span>{t('live')}</span>
          </div>
        </div>
      )}
    </section>
  );
}
