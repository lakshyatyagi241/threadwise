import { REALTIME_EVENT, type NotificationResponse } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isHiddenType } from '@/lib/notifications/hidden';
import { unreadKey } from '@/lib/notifications/unread';
import { useRealtimeEvent } from '@/lib/realtime';
import { listNotifications } from './api';
import {
  ALERT_VISIBLE_MS,
  FLUSH_MS,
  isReadingChat,
  wantsAlert,
  type CreatedPayload,
} from './live-alert-model';
import { notificationTarget } from './notification-model';
import { notificationListsKey, useMarkRead } from './use-notifications';

/** Rows read to find the one the event is about: a burst may have added several since. */
const LOOKUP_SIZE = 10;
/** Event ids remembered so a repeat delivery (the socket delivers at least once) shows nothing twice. */
const SEEN_MAX = 200;

export interface LiveAlert {
  /** The notification to show, or null while nothing is dropping down. */
  row: NotificationResponse | null;
  dismiss(): void;
  /** Marks the row read and goes to what it is about (the chat). */
  open(): void;
}

/**
 * The live side of notifications for the signed-in app: when the server says a notification was created, the bell's count is set to
 * the server's own number and the lists are read again; a chat message (not silent, not turned off by the person, not the chat that is
 * open) then drops one alert down over the screen for a few seconds. A newer alert replaces the one showing.
 */
export function useLiveAlert(): LiveAlert {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const markRead = useMarkRead();
  const [row, setRow] = useState<NotificationResponse | null>(null);

  const path = useRef(pathname);
  const seen = useRef(new Set<string>());
  const flush = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const newest = useRef<CreatedPayload | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    path.current = pathname;
  }, [pathname]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(flush.current);
      clearTimeout(hide.current);
    };
  }, []);

  const clear = useCallback(() => {
    clearTimeout(hide.current);
    setRow(null);
  }, []);

  const show = useCallback(async () => {
    const payload = newest.current;
    newest.current = null;
    if (!payload) return;
    try {
      const page = await listNotifications({ limit: LOOKUP_SIZE, unreadOnly: true });
      const found = page.data.find((n) => n.id === payload.notificationId);
      // The row may have been read or removed in the meantime (another device, the chat opened): then there is nothing to announce.
      if (!found || !alive.current || isReadingChat(path.current, payload.subjectId)) return;
      clearTimeout(hide.current);
      setRow(found);
      hide.current = setTimeout(() => setRow(null), ALERT_VISIBLE_MS);
    } catch {
      // The alert is a courtesy: the bell and the list still have the row, and the next event tries again.
    }
  }, []);

  useRealtimeEvent(REALTIME_EVENT.notificationCreated, (event) => {
    if (seen.current.has(event.id)) return;
    seen.current.add(event.id);
    if (seen.current.size > SEEN_MAX) {
      seen.current.delete(seen.current.values().next().value as string);
    }
    const payload = event.payload;
    // The badge is read again (never "+1" here, so a lost or repeated event cannot drift it). The server's number in the event also
    // counts the kinds the app hides, so it is not stored as is. A hidden kind changes nothing on screen.
    if (isHiddenType(payload.type)) return;
    void queryClient.invalidateQueries({ queryKey: unreadKey });
    void queryClient.invalidateQueries({ queryKey: notificationListsKey });

    if (!wantsAlert(payload) || isReadingChat(path.current, payload.subjectId)) return;
    newest.current = payload;
    clearTimeout(flush.current);
    flush.current = setTimeout(() => void show(), FLUSH_MS);
  });

  const open = useCallback(() => {
    if (!row) return;
    const target = notificationTarget(row);
    if (row.readAt === null) markRead.mutate(row.id);
    clear();
    if (target) router.push(target);
  }, [clear, markRead, router, row]);

  return { row, dismiss: clear, open };
}
