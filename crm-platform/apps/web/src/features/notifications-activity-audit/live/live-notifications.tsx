'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeClient } from '@/lib/realtime';
import { useMarkRead, useUnreadCount } from '../api/hooks';
import { notificationsApi } from '../api/service';
import type { Translator } from '../lib/copy';
import {
  createPinger,
  createTitleBadge,
  desktopEnabled,
  showDesktopAlert,
  soundEnabled,
  type TitleBadge,
} from './alerts';
import { EventClaimer, browserChannel } from './claim';
import { LiveNotificationsController, type LivePresenter } from './controller';
import { LiveToastHost, type LiveToastView } from './live-toast';
import { TOAST_LIFETIME_MS, type LiveAlert } from './model';
import { alertText, announcementText, desktopTag, desktopText } from './present';

const MAX_TOASTS = 3;

/**
 * Live notifications for the whole signed-in app: mount it once in the app layout, inside the realtime provider. It listens on the
 * session's one socket (no connection of its own), keeps the bell right on every page, and raises the toast, the ping, the desktop
 * alert, the screen-reader announcement and the tab-title badge.
 *
 * It does nothing it cannot do: without a socket (no realtime address, signed out, refused) only the tab title follows the polled
 * unread count, and it renders nothing until there is something to show.
 */
export function LiveNotifications() {
  const t = useTranslations('notifications');
  const router = useRouter();
  const qc = useQueryClient();
  const client = useRealtimeClient();
  const unread = useUnreadCount();
  const { markRead } = useMarkRead();

  const [toasts, setToasts] = useState<LiveToastView[]>([]);
  const [announcement, setAnnouncement] = useState({ n: 0, text: '' });
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // The latest translator, router and mutation, for callbacks created once per connection.
  const latest = useRef({ t: t as unknown as Translator, router, markRead });
  useEffect(() => {
    latest.current = { t: t as unknown as Translator, router, markRead };
  });

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (view: Omit<LiveToastView, 'id'>) => {
      const id = ++seq.current;
      setToasts((cur) => [...cur.slice(-(MAX_TOASTS - 1)), { ...view, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_LIFETIME_MS),
      );
    },
    [dismiss],
  );

  // --- the tab title -------------------------------------------------------------------------------------------------------
  const badge = useRef<TitleBadge | null>(null);
  const count = unread.data ?? 0;
  useEffect(() => {
    const b = createTitleBadge();
    badge.current = b;
    b.set(count);
    return () => {
      badge.current = null;
      b.dispose();
    };
    // Created once; the count is applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    badge.current?.set(count);
  }, [count]);

  // --- the live connection -------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!client) return;
    const pinger = createPinger();
    const disarm = pinger.armOnGesture();
    const claimer = new EventClaimer(browserChannel);

    const open = (alert: LiveAlert) => {
      if (alert.row.readAt === null) latest.current.markRead(alert.row.id);
      if (alert.href) latest.current.router.push(alert.href);
    };
    const presenter: LivePresenter = {
      ping: () => {
        pinger.ping();
      },
      toast: (toast) => {
        const tr = latest.current.t;
        if (toast.kind === 'summary') {
          push({ title: tr('live.summary', { count: toast.count }), body: null, href: null });
          return;
        }
        const { title, body } = alertText(tr, toast.alert);
        push({ title, body, href: toast.alert.href, rowId: toast.alert.row.id });
      },
      announce: (alerts) =>
        setAnnouncement((cur) => ({
          n: cur.n + 1,
          text: announcementText(latest.current.t, alerts),
        })),
      desktop: (alert) => {
        const { title, body } = desktopText(latest.current.t, alert);
        showDesktopAlert({ title, body, tag: desktopTag(alert), onClick: () => open(alert) });
      },
    };

    const controller = new LiveNotificationsController({
      client,
      qc,
      api: {
        list: (limit, signal) => notificationsApi.list(limit, signal),
        readSubject: (id) => notificationsApi.readSubject(id),
      },
      presenter,
      settings: { soundOn: soundEnabled, desktopOn: desktopEnabled },
      claimer,
      env: {
        isVisible: () => document.visibilityState === 'visible',
        location: () => ({ pathname: window.location.pathname, search: window.location.search }),
        now: () => Date.now(),
      },
    });
    controller.start();
    return () => {
      controller.stop();
      claimer.close();
      disarm();
    };
  }, [client, qc, push]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <LiveToastHost
        toasts={toasts}
        label={t('live.toastRegion')}
        openLabel={t('live.open')}
        dismissLabel={t('live.dismiss')}
        onDismiss={dismiss}
        onOpen={(toast) => {
          if (toast.rowId) latest.current.markRead(toast.rowId);
          dismiss(toast.id);
        }}
      />
      {/* The one place notifications are announced to a screen reader (the toast region above is silent on purpose). */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        <span key={announcement.n}>{announcement.text}</span>
      </div>
    </>
  );
}
