'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { announcementsResponseSchema, marqueeSeconds, type AnnouncementBar } from '@crm/contracts';
import { cn } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { useStoredValue } from '@/lib/use-stored-value';

const NS = 'admin-console-shell.announcements';

/** Tone to colours: the four WaDesk tones; an unknown tone reads as info. */
const TONES: Record<string, string> = {
  info: 'bg-primary/10 text-foreground border-primary/30',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
};

export const dismissKey = (token: string) => `dismissed:ann-${token}`;

/**
 * The announcement strip (WD-ASHELL-026): one marquee bar per tone. A dismissed bar stays hidden in this browser until its
 * group changes (the key is the joined ids), and pauses on hover so a link can be clicked.
 */
export function AnnouncementBars() {
  const q = useQuery({
    queryKey: ['shell', 'announcements'],
    queryFn: ({ signal }) =>
      apiFetch('/shell/announcements', { schema: announcementsResponseSchema, signal }),
    staleTime: 60_000,
  });
  const bars = q.data?.bars ?? [];
  if (bars.length === 0) return null;
  return (
    <div data-testid="announcement-bars">
      {bars.map((bar) => (
        <Bar key={bar.token} bar={bar} />
      ))}
    </div>
  );
}

function Bar({ bar }: { bar: AnnouncementBar }) {
  const t = useTranslations(NS);
  const [dismissed, setDismissed] = useStoredValue(dismissKey(bar.token));
  if (dismissed === '1') return null;
  const seconds = marqueeSeconds(bar.items);
  const items = (copy: number) =>
    bar.items.map((item) => (
      <span key={`${copy}-${item.id}`} className="mx-6 inline-flex items-center gap-2">
        {item.text}
        {item.linkUrl && <ItemLink url={item.linkUrl} label={item.linkLabel} />}
      </span>
    ));
  return (
    <div
      role="region"
      aria-label={t('label')}
      data-tone={bar.tone}
      className={cn(
        'group relative flex items-center overflow-hidden border-b px-3 py-1.5 text-sm',
        TONES[bar.tone] ?? TONES.info,
      )}
    >
      <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
        <div
          className="inline-flex min-w-full animate-[ann-scroll_var(--ann-seconds)_linear_infinite] group-hover:[animation-play-state:paused] motion-reduce:animate-none"
          style={{ ['--ann-seconds' as string]: `${seconds}s` }}
        >
          <span className="inline-block shrink-0">{items(0)}</span>
          <span aria-hidden="true" className="inline-block shrink-0">
            {items(1)}
          </span>
        </div>
      </div>
      {bar.dismissible && (
        <button
          type="button"
          aria-label={t('dismiss')}
          onClick={() => setDismissed('1')}
          className="ms-2 shrink-0 rounded px-2 text-lg leading-none outline-none hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-primary"
        >
          ×
        </button>
      )}
    </div>
  );
}

function ItemLink({ url, label }: { url: string; label: string | null }) {
  const external = /^https?:\/\//i.test(url);
  const text = `${label ?? url} →`;
  const cls = 'font-semibold underline underline-offset-2';
  return external ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cls}>
      {text}
    </a>
  ) : (
    <Link href={url} className={cls}>
      {text}
    </Link>
  );
}
