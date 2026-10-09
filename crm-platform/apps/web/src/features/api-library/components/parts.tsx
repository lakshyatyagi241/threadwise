'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useCallback, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, cn, useToast } from '@crm/ui';
import { relativeTime, statusTone } from '../lib/format';
import { CheckIcon, CopyIcon } from './icons';

/** `12 Mar 2026, 3:04 PM` in the viewer's language and workspace time zone. */
export function useFormatDate() {
  const locale = useLocale();
  const timeZone = useTimeZone();
  return useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
        new Date(iso),
      ),
    [locale, timeZone],
  );
}

/** "3 days ago" with the exact time as a tooltip. Only rendered after data arrives, so the clock never differs from the server's. */
export function RelativeTime({ iso }: { iso: string }) {
  const locale = useLocale();
  const fmt = useFormatDate();
  const [now] = useState(() => Date.now());
  return (
    <time dateTime={iso} title={fmt(iso)} className="cursor-default whitespace-nowrap">
      {relativeTime(iso, now, locale)}
    </time>
  );
}

// Light and dark: the tints sit on `bg-background`, the text colours are chosen for 4.5:1 on their own tint in both themes.
const METHOD_TONE: Record<string, string> = {
  GET: 'bg-success/15 text-success',
  POST: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  PUT: 'bg-warning/15 text-warning',
  PATCH: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  DELETE: 'bg-danger/15 text-danger',
};

export function MethodBadge({ method, className }: { method: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-[3.75rem] justify-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide',
        METHOD_TONE[method] ?? 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {method}
    </span>
  );
}

/** The HTTP status of a run: green for 2xx, red otherwise, a dash when the target never answered. */
export function StatusCodeBadge({ code }: { code: number | null }) {
  const t = useTranslations('api-library.common');
  return <Badge tone={statusTone(code)}>{code === null ? t('noAnswer') : code}</Badge>;
}

/** Success or failed, as a dot and a word (colour alone never carries it). */
export function ResultChip({ ok }: { ok: boolean }) {
  const t = useTranslations('api-library.common');
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span
        aria-hidden="true"
        className={cn('size-2 rounded-full', ok ? 'bg-success' : 'bg-danger')}
      />
      {ok ? t('success') : t('failed')}
    </span>
  );
}

/** Copies a text and says so; falls back to a toast when the clipboard is not available. */
export function CopyButton({
  text,
  label,
  iconOnly,
  className,
}: {
  text: string;
  label: string;
  /** A square icon button (for a table cell); otherwise a small text button. */
  iconOnly?: boolean;
  className?: string;
}) {
  const t = useTranslations('api-library.common');
  const { toast } = useToast();
  const [done, setDone] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      })
      .catch(() => toast(t('copyFailed'), 'danger'));
  };
  if (iconOnly)
    return (
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        title={done ? t('copied') : label}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary',
          className,
        )}
      >
        {done ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
      </button>
    );
  return (
    <Button variant="secondary" size="sm" aria-label={label} className={className} onClick={copy}>
      {done ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
      {done ? t('copied') : t('copy')}
    </Button>
  );
}

export function LoadError({ message, onRetry }: { message: ReactNode; onRetry: () => void }) {
  const t = useTranslations('api-library.common');
  return (
    <Alert tone="danger">
      {message}{' '}
      <button type="button" className="font-semibold underline" onClick={onRetry}>
        {t('retry')}
      </button>
    </Alert>
  );
}

/** A mono block for headers, payloads and answers: scrolls instead of widening the page. */
export function CodeBlock({
  children,
  label,
  className,
}: {
  children: string;
  label?: string;
  className?: string;
}) {
  return (
    <pre
      dir="ltr"
      aria-label={label}
      className={cn(
        'thin-scrollbar max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed',
        className,
      )}
    >
      {children}
    </pre>
  );
}

/** Placeholder rows while a table loads. */
export function SkeletonRows({ rows, cols }: { rows: number; cols: number }) {
  return (
    <tbody aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="border-b border-border last:border-b-0">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-4 py-3.5">
              <div
                className={cn(
                  'h-3.5 animate-pulse rounded bg-muted',
                  c === 0 ? 'w-40' : c === 2 ? 'w-56 max-w-full' : 'w-20',
                )}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
