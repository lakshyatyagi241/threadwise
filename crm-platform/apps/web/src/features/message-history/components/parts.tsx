'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type {
  MessageHistoryRow,
  MessageHistoryRowStatus,
  MessageHistoryType,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { initialsOf } from '../lib/format';

/** Turns a failed call into text. A code we have words for is translated; anything else is the generic line. Branches on `code`. */
export function useErrorText(): (e: unknown) => string {
  const t = useTranslations('message-history.errors');
  return (e) => {
    if (e instanceof ApiError) return t.has(e.code) ? t(e.code) : t('generic');
    return t('generic');
  };
}

type IconProps = { className?: string };
const base = (className?: string) => cn('size-3.5 shrink-0', className);

export function ArrowOutIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={base(className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M3 8h10M9 4l4 4-4 4" className="rtl:-scale-x-100 rtl:origin-center" />
    </svg>
  );
}
export function ArrowInIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={base(className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M13 8H3M7 4l-4 4 4 4" />
    </svg>
  );
}
export function CrossIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={base(className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
export function SearchIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={base(className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="5" />
      <path d="m11 11 3 3" />
    </svg>
  );
}
export function DownloadIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={base(className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M8 2v8M5 7l3 3 3-3M3 12v2h10v-2" />
    </svg>
  );
}
export function EyeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={base(className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

/** The direction mark of a row: outgoing, incoming, or an outgoing message that failed (Reference's three icons). */
export function DirectionMark({ row }: { row: Pick<MessageHistoryRow, 'direction' | 'status'> }) {
  const t = useTranslations('message-history.direction');
  if (row.direction === 'out' && row.status === 'failed') {
    return (
      <span
        title={t('failed')}
        className="inline-flex size-6 items-center justify-center rounded-full bg-danger/15 text-danger"
      >
        <CrossIcon className="size-3" />
        <span className="sr-only">{t('failed')}</span>
      </span>
    );
  }
  if (row.direction === 'out') {
    return (
      <span
        title={t('out')}
        className="inline-flex size-6 items-center justify-center rounded-full bg-success/15 text-success"
      >
        <ArrowOutIcon className="size-3" />
        <span className="sr-only">{t('out')}</span>
      </span>
    );
  }
  return (
    <span
      title={t('in')}
      className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-foreground/80"
    >
      <ArrowInIcon className="size-3" />
      <span className="sr-only">{t('in')}</span>
    </span>
  );
}

const STATUS_TONE: Record<MessageHistoryRowStatus, { dot: string; fg: string }> = {
  received: { dot: 'bg-foreground/70', fg: 'text-foreground/80' },
  read: { dot: 'bg-success', fg: 'text-success' },
  delivered: { dot: 'bg-success', fg: 'text-success' },
  sent: { dot: 'bg-success', fg: 'text-success' },
  failed: { dot: 'bg-danger', fg: 'text-danger' },
  queued: { dot: 'bg-border', fg: 'text-muted-foreground' },
};

/** Reference's status: a dot and the word; inbound rows read "Inbound", outbound the capitalised status. */
export function StatusMark({ status }: { status: MessageHistoryRowStatus }) {
  const t = useTranslations('message-history.status');
  const tone = STATUS_TONE[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-mono text-[11px]', tone.fg)}>
      <span className={cn('size-1.5 rounded-full', tone.dot)} aria-hidden="true" />
      {t(status)}
    </span>
  );
}

const TYPE_TONE: Partial<Record<MessageHistoryType, string>> = {
  auto_reply: 'bg-primary/10 text-primary',
  campaign: 'bg-warning/15 text-warning',
  broadcast: 'bg-primary/10 text-primary',
  scheduled: 'bg-warning/10 text-warning',
  template: 'bg-brand/10 text-brand',
  image: 'bg-primary/10 text-primary',
  video: 'bg-warning/15 text-warning',
  audio: 'bg-brand/10 text-brand',
  document: 'bg-warning/15 text-warning',
  location: 'bg-primary/10 text-primary',
};

export function TypePill({ type }: { type: MessageHistoryType }) {
  const t = useTranslations('message-history.type');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10.5px]',
        TYPE_TONE[type] ?? 'bg-muted text-foreground/80',
      )}
    >
      {t(type)}
    </span>
  );
}

/** The avatar circle: the initials of the name, a colour chosen from the row so a person keeps theirs. */
const AVATARS = ['bg-brand', 'bg-warning', 'bg-primary', 'bg-success'] as const;
export function Avatar({
  name,
  seed,
  className,
}: {
  name: string;
  seed: string;
  className?: string;
}) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-brand-foreground',
        AVATARS[h % AVATARS.length],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Who the row is about: the contact's name, else the number, else where it came from (Reference's rule). */
export function rowName(row: MessageHistoryRow, fallback: string): string {
  return row.contact.name ?? row.recipient.value ?? row.entity?.name ?? fallback;
}
