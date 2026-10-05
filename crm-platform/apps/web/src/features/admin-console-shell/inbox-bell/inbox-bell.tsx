'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { conversationListResponseSchema, type ConversationListResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { apiFetch } from '@/lib/api/client';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  BASE_POLL_MS,
  BELL_DISMISS_KEY,
  BELL_POS_KEY,
  clampPos,
  countLabel,
  hidesBell,
  latestMark,
  nextDelay,
  parseDismissal,
  shouldAlert,
  visibility,
  type Pos,
} from './logic';

const NS = 'admin-console-shell.inboxBell';

const read = (store: Storage | undefined, key: string): string | null => {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const write = (store: Storage | undefined, key: string, value: string | null) => {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    /* not remembered */
  }
};

/** A short 880 Hz tone through WebAudio. Browsers keep it muted until the first gesture; a refusal is ignored. */
function beep() {
  try {
    const Ctx = window.AudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => void ctx.close();
  } catch {
    /* no audio */
  }
}

/**
 * The floating "new messages" pill (TW-ASHELL-028), on every page except the inbox. It polls the unread tab every 15 seconds
 * (doubling after a 429 or an error, up to 5 minutes, and paused while the tab is hidden), beeps and flashes the tab title
 * when the total rises, opens a small list of the latest five, and can be dragged anywhere and dismissed until something newer.
 */
export function InboxBell() {
  const pathname = usePathname();
  const allowed = useCan('inbox.conversation.read') && !hidesBell(pathname);
  return allowed ? <Pill /> : null;
}

function Pill() {
  const t = useTranslations(NS);
  const [data, setData] = useState<ConversationListResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : read(window.sessionStorage, BELL_DISMISS_KEY),
  );
  const [pos, setPos] = useState<Pos | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = read(window.localStorage, BELL_POS_KEY);
      return raw ? clampPos(JSON.parse(raw) as Pos, window.innerWidth, window.innerHeight) : null;
    } catch {
      return null;
    }
  });
  const drag = useRef<{ dx: number; dy: number; moved: boolean; sx: number; sy: number } | null>(
    null,
  );
  const previous = useRef<number | null>(null);
  const baseTitle = useRef('');

  // The poll loop: a timer chain whose delay backs off on trouble; hidden tabs skip and fetch once on return.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = BASE_POLL_MS;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.hidden) {
        timer = setTimeout(() => void tick(), delay);
        return;
      }
      try {
        const res = await apiFetch('/inbox/conversations', {
          query: { tab: 'unread', limit: 5 },
          schema: conversationListResponseSchema,
        });
        if (stopped) return;
        delay = nextDelay(delay, 'ok');
        setData(res);
      } catch (e) {
        delay = nextDelay(
          delay,
          e instanceof ApiError && e.status === 429 ? 'throttled' : 'failed',
        );
      }
      timer = setTimeout(() => void tick(), delay);
    };
    void tick();
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const total = data?.meta.counts.unread ?? 0;
  const items = data?.data ?? [];
  const mark = latestMark(items);
  const dismissal = parseDismissal(dismissedAt);
  const vis = visibility(total, mark, dismissal);

  // Side effects of a new total: sound, title flash, and forgetting a dismissal that no longer applies.
  useEffect(() => {
    if (!data) return;
    if (shouldAlert(previous.current, total)) {
      beep();
      baseTitle.current ||= document.title;
      let on = true;
      const flash = setInterval(() => {
        document.title = on ? `(${total}) ${baseTitle.current}` : baseTitle.current;
        on = !on;
      }, 1200);
      const stop = () => {
        clearInterval(flash);
        document.title = baseTitle.current;
        window.removeEventListener('focus', stop);
      };
      window.addEventListener('focus', stop);
    }
    previous.current = total;
  }, [data, total]);
  // A dismissal that no longer applies is forgotten in storage; the in-memory copy is harmless (anything newer shows anyway).
  useEffect(() => {
    if (data && vis.clear) write(window.sessionStorage, BELL_DISMISS_KEY, null);
  }, [data, vis.clear]);

  if (!vis.show) return null;

  const dismiss = () => {
    const value = JSON.stringify({ mark, total });
    write(window.sessionStorage, BELL_DISMISS_KEY, value);
    setDismissedAt(value);
    setOpen(false);
  };
  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { insetInlineEnd: 16, bottom: 16 };

  return (
    <div style={style} className="group fixed z-40" data-testid="inbox-bell">
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('label', { count: total })}
        onPointerDown={(e) => {
          const r = e.currentTarget.parentElement!.getBoundingClientRect();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            dx: e.clientX - r.left,
            dy: e.clientY - r.top,
            moved: false,
            sx: e.clientX,
            sy: e.clientY,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
          if (d.moved) {
            setPos(
              clampPos(
                { x: e.clientX - d.dx, y: e.clientY - d.dy },
                window.innerWidth,
                window.innerHeight,
              ),
            );
          }
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (d?.moved && pos) write(window.localStorage, BELL_POS_KEY, JSON.stringify(pos));
          else setOpen((v) => !v);
        }}
        className="flex touch-none items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        <span className="rounded-full bg-primary-foreground/20 px-2 text-xs tabular-nums">
          {countLabel(total)}
        </span>
        {t('pill', { count: total })}
      </button>
      <button
        type="button"
        aria-label={t('dismiss')}
        onClick={dismiss}
        className="absolute -end-2 -top-2 hidden size-5 items-center justify-center rounded-full bg-foreground text-xs text-background group-hover:flex group-focus-within:flex"
      >
        ×
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('title')}
          className="absolute bottom-full end-0 mb-2 w-[340px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm font-semibold">
            {t('title')}
            <span className="text-xs text-muted-foreground">{countLabel(total)}</span>
          </div>
          <ul className="max-h-[320px] overflow-y-auto">
            {items.slice(0, 5).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/inbox?c=${c.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-3 px-4 py-2 outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {c.title.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.preview ?? ''}
                    </span>
                  </span>
                  <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                    {c.unreadCount}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href="/inbox"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2 text-center text-sm font-semibold text-primary hover:bg-muted"
          >
            {t('viewInbox')}
          </Link>
        </div>
      )}
    </div>
  );
}
