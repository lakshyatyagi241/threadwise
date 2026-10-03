'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import {
  ANNOUNCEMENT_TONES,
  liveAnnouncementsResponseSchema,
  type AnnouncementTone,
  type LiveAnnouncement,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import './site/site.css';

const TONE_STYLE: Record<AnnouncementTone, { bg: string; fg: string }> = {
  info: { bg: '#0b1f1c', fg: '#fbfaf6' },
  promo: { bg: '#4a3322', fg: '#fbfaf6' },
  warning: { bg: '#e5a04e', fg: '#0b1f1c' },
  success: { bg: '#128c7e', fg: '#ffffff' },
};

const storageKey = (ids: string[]) => `dismissed:ann-${ids.join('-')}`;
const read = (key: string): boolean => {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

/**
 * The announcement bar at the top of the signed-in app (TW-CMS-017): one scrolling bar per tone. A bar with a dismissible
 * message has a close button; dismissal is remembered in the browser under the set of ids it showed, so the bar comes back
 * when that set changes. Scrolling pauses on hover and stops for people who ask for reduced motion.
 */
export function AnnouncementBar() {
  const t = useTranslations('marketing-site-cms.bar');
  const q = useQuery({
    queryKey: ['cms', 'announcements'],
    queryFn: ({ signal }) =>
      apiFetch('/cms/announcements', { schema: liveAnnouncementsResponseSchema, signal }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const groups = useMemo(
    () =>
      ANNOUNCEMENT_TONES.map((tone) => ({
        tone,
        items: (q.data?.data ?? []).filter((a) => a.tone === tone),
      })).filter((g) => g.items.length > 0),
    [q.data],
  );
  return (
    <div data-testid="announcement-bars">
      {groups.map((g) => (
        <Bar
          key={g.tone}
          tone={g.tone}
          items={g.items}
          closeLabel={t('dismiss')}
          region={t('region')}
        />
      ))}
    </div>
  );
}

function Bar({
  tone,
  items,
  closeLabel,
  region,
}: {
  tone: AnnouncementTone;
  items: LiveAnnouncement[];
  closeLabel: string;
  region: string;
}) {
  const key = storageKey(items.map((i) => i.id));
  const [closed, setClosed] = useState(false);
  // Read from storage after hydration (the server never knows), without an effect that sets state.
  const stored = useSyncExternalStore(
    (notify) => {
      window.addEventListener('storage', notify);
      return () => window.removeEventListener('storage', notify);
    },
    () => read(key),
    () => false,
  );
  if (closed || stored) return null;
  const style = TONE_STYLE[tone];
  const chars = items.reduce((n, i) => n + i.text.length + (i.linkLabel?.length ?? 0), 0);
  const seconds = Math.max(20, Math.round(chars / 5));
  const canClose = items.some((i) => i.dismissible);
  const row = (copy: number) =>
    items.map((a) => (
      <span key={`${a.id}-${copy}`} aria-hidden={copy > 0 ? true : undefined}>
        {a.text}
        {a.linkUrl && (
          <>
            {' · '}
            <a href={a.linkUrl} className="underline" rel="noopener noreferrer">
              {a.linkLabel ? `${a.linkLabel} →` : '→'}
            </a>
          </>
        )}
      </span>
    ));
  return (
    <div
      role="region"
      aria-label={region}
      data-tone={tone}
      className="flex items-center gap-2 px-3 py-1.5 text-xs"
      style={{ background: style.bg, color: style.fg }}
    >
      <div className="cms-marquee min-w-0 flex-1">
        <div className="cms-marquee-track" style={{ ['--cms-marquee-s' as string]: `${seconds}s` }}>
          {row(0)}
          {row(1)}
        </div>
      </div>
      {canClose && (
        <button
          type="button"
          aria-label={closeLabel}
          className="shrink-0 rounded px-1.5 text-base leading-none opacity-80 hover:opacity-100"
          onClick={() => {
            try {
              window.localStorage.setItem(key, '1');
            } catch {
              // storage blocked: the bar simply returns on the next visit
            }
            setClosed(true);
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
