'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeClient, useVisibilityReport } from '@/lib/realtime';
import { useMarkRead, useUnreadCount } from '../api/hooks';
import { NOTIFICATION_KEYS } from '../api/keys';
import { usePreferences } from '../api/prefs-hooks';
import { mayPush, type PrefsState } from '../prefs/model';
import { savedDeviceId } from '../push/client';
import { usePushWorkerMessages } from '../push/use-worker-messages';
import { notificationsApi } from '../api/service';
import type { Translator } from '../lib/copy';
import {
  createPinger,
  createTitleBadge,
  desktopEnabled,
  desktopPermission,
  showDesktopAlert,
  soundEnabled,
  type TitleBadge,
} from './alerts';
import { EventClaimer, browserChannel } from './claim';
import { LiveNotificationsController, type LivePresenter } from './controller';
import { LiveToastHost, type LiveToastView } from './live-toast';
import { toastLifetimeMs, typeMeta } from '../lib/catalogue';
import type { LiveAlert } from './model';
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
  // The person's own preferences, loaded once so a pop-up or ping they turned off stays quiet even on a server that does not yet
  // put the flags on the event. A failed load changes nothing: the type defaults apply.
  usePreferences();
  // Tell the server whether this tab is in front (a closed-tab browser push skips a person who can see the app), and answer the
  // service worker's requests (open a link, subscribe again).
  useVisibilityReport();
  usePushWorkerMessages();

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
        setTimeout(() => dismiss(id), toastLifetimeMs(view.tone ?? 'info')),
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
        if (toast.kind !== 'alert') {
          // The overflow summary and the generic fallback carry no row: words only. The toast region is silent on purpose, so the
          // same words go to the screen-reader region.
          const title =
            toast.kind === 'generic' && toast.count === 1
              ? tr('live.generic')
              : tr('live.summary', { count: toast.count });
          push({ title, body: null, href: null });
          setAnnouncement((cur) => ({ n: cur.n + 1, text: title }));
          return;
        }
        const { title, body } = alertText(tr, toast.alert);
        const meta = typeMeta(toast.alert.type);
        push({
          title,
          body,
          href: toast.alert.href,
          rowId: toast.alert.row.id,
          icon: meta.icon,
          tone: meta.tone,
        });
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
      prefs: () => qc.getQueryData<PrefsState>(NOTIFICATION_KEYS.preferences)?.entries,
      api: {
        list: (limit, signal) => notificationsApi.list(limit, signal),
        readSubject: (id) => notificationsApi.readSubject(id),
      },
      presenter,
      settings: {
        soundOn: soundEnabled,
        desktopOn: desktopEnabled,
        // Browser push already covers a background tab on a device where it is enabled: no second, in-page alert for the same event.
        pushCovers: (type) =>
          savedDeviceId() !== null &&
          desktopPermission() === 'granted' &&
          mayPush(qc.getQueryData<PrefsState>(NOTIFICATION_KEYS.preferences)?.entries, type),
      },
      claimer,
      env: {
        isVisible: () => document.visibilityState === 'visible',
        onVisible: (listener) => {
          const onChange = () => {
            if (document.visibilityState === 'visible') listener();
          };
          document.addEventListener('visibilitychange', onChange);
          return () => document.removeEventListener('visibilitychange', onChange);
        },
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
