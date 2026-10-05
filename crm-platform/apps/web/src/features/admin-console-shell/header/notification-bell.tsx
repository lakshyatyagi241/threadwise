'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { bellBadge } from '@crm/contracts';
import { Popover, Spinner, cn } from '@crm/ui';
import { timeAgo } from './header-logic';
import { useBellFeed } from './api';
import { useHeadline } from './use-headline';

const SEVERITY_DOT = {
  info: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
} as const;

const BellIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M8 1.5a4 4 0 0 0-4 4v2.4L2.7 11h10.6L12 7.9V5.5a4 4 0 0 0-4-4z" />
    <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" />
  </svg>
);

/** WD-ASHELL-006: the operator bell. Badge capped at 99+, pane loads on open, mark all read, clear all, "View all". */
export function NotificationBell({ enabled }: { enabled: boolean }) {
  const t = useTranslations('admin-console-shell.header.bell');
  const headline = useHeadline();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const feed = useBellFeed(enabled);
  const close = useCallback(() => setOpen(false), []);
  const unread = feed.data?.unread ?? 0;
  const badge = bellBadge(unread);
  const act = (clear: boolean) => void feed.markRead(clear).catch(() => undefined);

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="bell-toggle"
        title={t('title')}
        aria-label={badge ? t('labelUnread', { count: unread }) : t('title')}
        aria-expanded={open}
        onClick={() => {
          if (!open) void feed.refetch();
          setOpen(!open);
        }}
        className="relative inline-flex size-8 items-center justify-center rounded-full border border-border hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
      >
        <BellIcon />
        {badge && (
          <span
            data-testid="bell-badge"
            className="absolute -end-1 -top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-4 text-danger-foreground"
          >
            {badge}
          </span>
        )}
      </button>
      <Popover
        open={open}
        onClose={close}
        label={t('title')}
        className="space-y-0 overflow-hidden p-0 max-md:fixed max-md:inset-x-3 max-md:top-16 max-md:w-auto md:w-[360px]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {t('inbox')}
            </div>
            <div className="text-base font-semibold">{t('title')}</div>
          </div>
          <button
            type="button"
            data-testid="bell-read-all"
            onClick={() => act(false)}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {t('markAllRead')}
          </button>
        </div>
        <div
          data-testid="bell-list"
          className="max-h-[420px] divide-y divide-border overflow-y-auto"
        >
          {feed.isPending ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-xs text-muted-foreground">
              <Spinner label={t('loading')} />
              {t('loading')}
            </div>
          ) : !feed.data || feed.data.items.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">{t('empty')}</div>
          ) : (
            feed.data.items.map((n) => (
              <Link
                key={n.id}
                href={n.actionUrl}
                onClick={close}
                className={cn('flex gap-3 px-4 py-3 hover:bg-muted', n.unread && 'bg-muted/50')}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    n.unread ? SEVERITY_DOT[n.severity] : 'bg-transparent',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{headline(n)}</span>
                  {n.message && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {n.message}
                    </span>
                  )}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {timeAgo(n.at, feed.dataUpdatedAt, locale)}
                  </span>
                </span>
              </Link>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border bg-muted/40 px-4 py-2.5">
          <button
            type="button"
            data-testid="bell-clear"
            onClick={() => act(true)}
            className="text-xs font-semibold text-danger hover:underline"
          >
            {t('clearAll')}
          </button>
          <Link
            href="/admin/notifications"
            onClick={close}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {t('viewAll')}
          </Link>
        </div>
      </Popover>
    </div>
  );
}
