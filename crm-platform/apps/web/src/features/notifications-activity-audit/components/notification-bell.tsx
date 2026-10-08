'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import type { NotificationResponse } from '@crm/contracts';
import { Popover, Spinner, cn } from '@crm/ui';
import { NavIcon } from '@/components/shell/nav-icons';
import { useFeed, useMarkRead, useUnreadCount } from '../api/hooks';
import { notificationHref, typeMeta } from '../lib/catalogue';
import { badgeText, notificationText, type Translator } from '../lib/copy';
import { useAlertSettings, type AlertSettings } from '../live/use-alert-settings';
import { TypeIcon } from './type-icon';

/** Where a person tunes which events reach them (a pane of the account hub). */
export const PREFERENCES_HREF = '/account/notifications';

/**
 * The header bell (WD-NOTIF-006): an unread badge and a panel with the newest notifications. The badge and the list follow the
 * live socket (see `live/`), and fall back to a one-minute poll when it is down. Clicking a notification marks it read and
 * opens what it is about (the server tells the other tabs). The panel's footer holds this browser's alert switches.
 */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const feed = useFeed(open);
  const { markRead, markAllRead, markingAll } = useMarkRead();
  const settings = useAlertSettings();
  const close = useCallback(() => setOpen(false), []);

  // While the panel is open its own total is the freshest; otherwise the polled count.
  const count = open && feed.data ? feed.data.meta.unread : (unread.data ?? 0);
  const badge = badgeText(count);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={badge ? t('bell.labelUnread', { count }) : t('bell.label')}
        title={t('bell.label')}
        className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        <NavIcon name="bell" className="size-5" />
        {badge ? (
          <span
            aria-hidden="true"
            className="absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-danger-foreground ring-2 ring-background"
          >
            {badge}
          </span>
        ) : null}
      </button>
      <Popover
        open={open}
        onClose={close}
        label={t('bell.title')}
        className="fixed end-2 start-2 top-14 mt-0 w-auto space-y-0 overflow-hidden p-0 sm:absolute sm:start-auto sm:end-0 sm:top-full sm:mt-1 sm:w-96"
      >
        <BellPanel
          count={count}
          markingAll={markingAll}
          onMarkAll={() => markAllRead()}
          loading={feed.isPending}
          failed={feed.isError && !feed.data}
          items={feed.data?.data ?? []}
          onRetry={() => void feed.refetch()}
          onOpen={(n) => {
            if (n.readAt === null) markRead(n.id);
            close();
          }}
          settings={settings}
          onNavigate={close}
        />
      </Popover>
    </div>
  );
}

/** Everything inside the open panel; a plain component of props so every state can be shown in a test. */
export function BellPanel({
  count,
  markingAll,
  onMarkAll,
  loading,
  failed,
  items,
  onRetry,
  onOpen,
  settings,
  onNavigate,
}: {
  count: number;
  markingAll: boolean;
  onMarkAll: () => void;
  loading: boolean;
  failed: boolean;
  items: NotificationResponse[];
  onRetry: () => void;
  onOpen: (n: NotificationResponse) => void;
  settings: AlertSettings;
  /** Called when the footer link is followed, so the panel can close. */
  onNavigate?: () => void;
}) {
  const t = useTranslations('notifications');
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{t('bell.title')}</h2>
        <button
          type="button"
          disabled={count === 0 || markingAll}
          onClick={onMarkAll}
          className="rounded-md px-1 text-xs font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
        >
          {t('bell.markAll')}
        </button>
      </div>
      <FeedBody loading={loading} failed={failed} items={items} onRetry={onRetry} onOpen={onOpen} />
      <AlertSwitches settings={settings} />
      <div className="border-t border-border px-4 py-2.5">
        <Link
          href={PREFERENCES_HREF}
          onClick={onNavigate}
          className="rounded-md px-1 py-0.5 text-xs font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('bell.preferences')}
        </Link>
      </div>
    </>
  );
}

/** This browser's two switches: the ping, and desktop (OS) alerts, which are only ever requested from the click on "Enable". */
export function AlertSwitches({ settings }: { settings: AlertSettings }) {
  const t = useTranslations('notifications');
  const row =
    'rounded-md px-1 py-0.5 text-start text-xs font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary';
  return (
    <div
      role="group"
      aria-label={t('bell.settings')}
      className="flex flex-col items-start gap-1 border-t border-border px-4 py-2.5"
    >
      <button
        type="button"
        role="switch"
        aria-checked={settings.soundOn}
        aria-label={t('bell.sound')}
        onClick={() => settings.setSound(!settings.soundOn)}
        className={row}
      >
        {settings.soundOn ? t('bell.soundOn') : t('bell.soundOff')}
      </button>
      {settings.desktop === 'default' && (
        <button type="button" onClick={() => void settings.enableDesktop()} className={row}>
          {t('bell.desktopEnable')}
        </button>
      )}
      {settings.desktop === 'granted' && (
        <button
          type="button"
          role="switch"
          aria-checked={settings.desktopOn}
          aria-label={t('bell.desktopHint')}
          onClick={() => settings.setDesktop(!settings.desktopOn)}
          className={row}
        >
          {settings.desktopOn ? t('bell.desktopOn') : t('bell.desktopOff')}
        </button>
      )}
      {settings.desktop === 'denied' && (
        <p className="px-1 text-xs text-muted-foreground">{t('bell.desktopBlocked')}</p>
      )}
    </div>
  );
}

function FeedBody({
  loading,
  failed,
  items,
  onRetry,
  onOpen,
}: {
  loading: boolean;
  failed: boolean;
  items: NotificationResponse[];
  onRetry: () => void;
  onOpen: (n: NotificationResponse) => void;
}) {
  const t = useTranslations('notifications');
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
        <Spinner label={t('bell.loading')} /> {t('bell.loading')}
      </div>
    );
  }
  if (failed) {
    return (
      <div className="space-y-2 px-4 py-8 text-center text-sm">
        <p className="text-muted-foreground">{t('bell.failed')}</p>
        <button type="button" onClick={onRetry} className="font-medium text-brand hover:underline">
          {t('bell.retry')}
        </button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('bell.empty')}</p>
    );
  }
  return (
    <ul className="max-h-[min(26rem,70dvh)] divide-y divide-border overflow-y-auto">
      {items.map((n) => (
        <li key={n.id}>
          <NotificationRow n={n} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

export function NotificationRow({
  n,
  onOpen,
}: {
  n: NotificationResponse;
  onOpen: (n: NotificationResponse) => void;
}) {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const { title, body } = notificationText(t as unknown as Translator, n);
  const href = notificationHref(n);
  const meta = typeMeta(n.type);
  const unread = n.readAt === null;
  const cls = cn(
    'flex w-full items-start gap-3 px-4 py-3 text-start outline-none transition hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
    unread && 'bg-brand/5',
  );
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          unread ? 'bg-brand' : 'bg-transparent',
        )}
      />
      <TypeIcon icon={meta.icon} tone={meta.tone} />
      <span className="min-w-0 flex-1">
        <span
          dir="auto"
          className={cn('block truncate text-sm', unread ? 'font-semibold' : 'font-medium')}
        >
          {title}
        </span>
        {body && (
          <span dir="auto" className="line-clamp-2 break-words text-xs text-muted-foreground">
            {body}
          </span>
        )}
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {format.relativeTime(new Date(n.createdAt), new Date())}
        </span>
      </span>
      {unread && <span className="sr-only">{t('bell.unread')}</span>}
    </>
  );
  return href ? (
    <Link href={href} onClick={() => onOpen(n)} className={cls}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={() => onOpen(n)} className={cls}>
      {content}
    </button>
  );
}
