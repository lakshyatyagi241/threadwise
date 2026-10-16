'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { cn } from '@crm/ui';
import { InlinePanel } from './inline-panel';

const pad = (n: number) => String(n).padStart(2, '0');
/** A calendar day as `YYYY-MM-DD` (the day on the visitor's own clock, not UTC). */
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

export interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}

/**
 * A range field with a calendar: the closed field reads "Start date → End date"; opened, it shows one month with arrows, quick
 * ranges (Today, Last 7 days, Last 30 days, This month) and a Clear. Two taps pick the range (the earlier one is the start whichever
 * is tapped first). Values are `YYYY-MM-DD` strings, as the filters keep them.
 */
export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const t = useTranslations('team-inbox-conversations.list.filters');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = parse(from) ?? new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  // The first tap of a pair waits here until the second one completes the range.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const fmt = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }), [locale]);
  const title = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
    [locale],
  );
  const firstDay = useMemo(() => {
    try {
      const info = (
        new Intl.Locale(locale) as unknown as { getWeekInfo?: () => { firstDay: number } }
      ).getWeekInfo?.();
      return info ? info.firstDay % 7 : 0;
    } catch {
      return 0;
    }
  }, [locale]);
  const weekdays = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    // 2023-01-01 is a Sunday.
    return Array.from({ length: 7 }, (_, i) =>
      f.format(new Date(2023, 0, 1 + ((firstDay + i) % 7))),
    );
  }, [locale, firstDay]);

  const cells = useMemo(() => {
    const lead = (month.getDay() - firstDay + 7) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: days }, (_, i) =>
        iso(new Date(month.getFullYear(), month.getMonth(), i + 1)),
      ),
    ];
  }, [month, firstDay]);

  const today = iso(new Date());
  const lo = anchor ? (hover && hover < anchor ? hover : anchor) : from;
  const hi = anchor ? (hover && hover > anchor ? hover : anchor) : to || from;

  function pick(day: string) {
    if (anchor === null) {
      setAnchor(day);
      return;
    }
    const [a, b] = day < anchor ? [day, anchor] : [anchor, day];
    onChange({ from: a, to: b });
    setAnchor(null);
    setOpen(false);
  }
  function preset(days: number | 'month') {
    const end = new Date();
    const start =
      days === 'month'
        ? new Date(end.getFullYear(), end.getMonth(), 1)
        : new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
    onChange({ from: iso(start), to: iso(end) });
    setMonth(new Date(start.getFullYear(), start.getMonth(), 1));
    setAnchor(null);
    setOpen(false);
  }
  const shift = (by: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1));
  const show = (s: string) => (parse(s) ? fmt.format(parse(s)!) : '');

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="inbox-filters-dates"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary',
          open && 'border-primary',
        )}
      >
        <span className={cn('min-w-0 truncate', !from && 'text-muted-foreground')}>
          {from ? show(from) : t('from')}
        </span>
        <span className="text-muted-foreground rtl:rotate-180" aria-hidden>
          →
        </span>
        <span className={cn('min-w-0 truncate', !to && 'text-muted-foreground')}>
          {to ? show(to) : t('to')}
        </span>
        <svg
          viewBox="0 0 20 20"
          className="size-4 shrink-0 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden
        >
          <rect x="3" y="4.5" width="14" height="12" rx="2" />
          <path d="M3 8h14M7 3v3M13 3v3" />
        </svg>
      </button>
      <InlinePanel
        open={open}
        onClose={() => {
          setOpen(false);
          setAnchor(null);
        }}
        label={t('dateRange')}
        className="p-3"
      >
        <div className="mb-2 flex flex-wrap gap-1.5">
          {(
            [
              ['today', 1],
              ['last7', 7],
              ['last30', 30],
              ['thisMonth', 'month'],
            ] as const
          ).map(([k, v]) => (
            <button
              key={k}
              type="button"
              onClick={() => preset(v)}
              className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t(k)}
            </button>
          ))}
        </div>
        <div className="mb-1 flex items-center justify-between">
          <button
            type="button"
            aria-label={t('previousMonth')}
            onClick={() => shift(-1)}
            className="grid size-7 place-items-center rounded-md hover:bg-muted rtl:rotate-180 focus-visible:ring-2 focus-visible:ring-primary"
          >
            ‹
          </button>
          <p className="text-sm font-semibold" aria-live="polite">
            {title.format(month)}
          </p>
          <button
            type="button"
            aria-label={t('nextMonth')}
            onClick={() => shift(1)}
            className="grid size-7 place-items-center rounded-md hover:bg-muted rtl:rotate-180 focus-visible:ring-2 focus-visible:ring-primary"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
          {weekdays.map((w, i) => (
            <span key={i} className="py-1">
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(null)}>
          {cells.map((day, i) => {
            if (!day) return <span key={`b${i}`} />;
            const edge = day === lo || day === hi;
            const within = Boolean(lo) && day > lo && day < hi;
            return (
              <button
                key={day}
                type="button"
                data-testid={`inbox-filters-day-${day}`}
                aria-pressed={edge}
                aria-label={show(day)}
                onClick={() => pick(day)}
                onMouseEnter={() => setHover(day)}
                className={cn(
                  'h-8 text-xs focus-visible:ring-2 focus-visible:ring-primary',
                  within && 'bg-primary/10 text-primary',
                  edge
                    ? 'rounded-md bg-primary font-semibold text-primary-foreground'
                    : !within && 'rounded-md hover:bg-muted',
                  day === today && !edge && 'font-semibold text-primary',
                )}
              >
                {Number(day.slice(8))}
              </button>
            );
          })}
        </div>
        {(from || to) && (
          <button
            type="button"
            onClick={() => {
              onChange({ from: '', to: '' });
              setAnchor(null);
            }}
            className="mt-2 text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('clearDates')}
          </button>
        )}
      </InlinePanel>
    </div>
  );
}
