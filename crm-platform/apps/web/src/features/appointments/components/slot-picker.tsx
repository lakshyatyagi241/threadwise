'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { Button, Select, Spinner, cn } from '@crm/ui';
import { errorKind } from '../lib/errors';
import { formatDayKey, formatMonthYear, formatTime, weekdayLabel } from '../lib/format';
import {
  firstDayWithSlots,
  groupSlotsByDay,
  monthMatrix,
  weekdayOrder,
  type Slot,
} from '../lib/slots';
import {
  addDays,
  addMonths,
  dayKeyOf,
  offsetLabel,
  startOfMonth,
  startOfZonedDay,
  zonesWith,
} from '../lib/zone';
import { ChevronLeftIcon, ChevronRightIcon, GlobeIcon, flip } from './icons';

export interface SlotPickerProps {
  /** Cache namespace: the same picker for another type or booking must use another scope. */
  scope: string;
  /** Loads the open times between two instants (`[from, to)`). */
  load: (range: { from: string; to: string }, signal?: AbortSignal) => Promise<Slot[]>;
  /** The zone times are shown in and days are cut in. */
  zone: string;
  /** Present: shows the "Time zone" selector and calls this when it changes. */
  onZoneChange?: (zone: string) => void;
  /** The chosen start (ISO), or null. */
  value: string | null;
  onChange: (slot: Slot | null) => void;
  /** How many days ahead people may book; the calendar does not go past it. */
  horizonDays?: number;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn?: number;
  /** Shown under the calendar when the booking type runs in another zone than the one displayed. */
  typeZone?: string;
  /** A time that cannot be picked (the booking being moved keeps its own time out of the list). */
  disabledStart?: string | null;
  className?: string;
}

/**
 * Pick a day, then a time. The calendar lists the month; days with an open time are marked and the rest cannot be chosen.
 * Times are grouped by the day they fall on in `zone`, so a visitor in another time zone sees their own calendar days. Used
 * by the public booking page, the public manage (reschedule) page and the staff reschedule dialog, so all three behave the
 * same. When the first month has nothing open it moves on to the first month that has (up to the horizon).
 */
export function SlotPicker(p: SlotPickerProps) {
  const t = useTranslations('appointments.picker');
  const locale = useLocale();
  const zone = p.zone;
  const weekStartsOn =
    p.weekStartsOn ?? (locale.startsWith('en') && !locale.includes('GB') ? 0 : 1);
  const [nowMs] = useState(() => Date.now());
  const today = dayKeyOf(nowMs, zone);
  const lastDay = p.horizonDays ? addDays(today, p.horizonDays) : addDays(today, 365);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [day, setDay] = useState<string | null>(p.value ? dayKeyOf(p.value, zone) : null);
  const [touched, setTouched] = useState(false);
  const headingId = useId();
  const zoneId = useId();

  const from = startOfZonedDay(month, zone).toISOString();
  const to = startOfZonedDay(addMonths(month, 1), zone).toISOString();
  const q = useQuery({
    queryKey: ['appointments', 'picker', p.scope, zone, from, to],
    queryFn: ({ signal }) => p.load({ from, to }, signal),
    retry: false,
    staleTime: 30_000,
  });

  const groups = useMemo(() => groupSlotsByDay(q.data ?? [], zone), [q.data, zone]);
  const byDay = useMemo(() => new Map(groups.map((g) => [g.day, g.slots])), [groups]);

  // Nothing open this month and nobody has looked around yet: show the first month that has a time. (State is adjusted
  // while rendering, guarded so it settles: the new month has its own query, which is not a success until it loads.)
  if (!touched && q.isSuccess && groups.length === 0 && addMonths(month, 1) <= lastDay)
    setMonth(addMonths(month, 1));

  // Pick the first open day of the month when nobody has picked one.
  if (day === null && q.isSuccess) {
    const first = firstDayWithSlots(groups, today);
    if (first) setDay(first);
  }

  const prevDisabled = month <= startOfMonth(today);
  const nextDisabled = addMonths(month, 1) > lastDay;
  const rows = monthMatrix(month, weekStartsOn);
  const heads = weekdayOrder(weekStartsOn);
  const times = day ? (byDay.get(day) ?? []) : [];

  const go = (n: number) => {
    setTouched(true);
    setMonth((m) => addMonths(m, n));
  };

  return (
    <div className={cn('space-y-4', p.className)}>
      {p.onZoneChange && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <GlobeIcon className="size-4 text-muted-foreground" />
          <label htmlFor={zoneId} className="text-muted-foreground">
            {t('timeZone')}
          </label>
          <Select
            id={zoneId}
            value={zone}
            onChange={(e) => {
              setDay(null);
              p.onChange(null);
              p.onZoneChange?.(e.target.value);
            }}
            className="h-9 w-auto min-w-0 max-w-full flex-1 sm:max-w-xs"
          >
            {zonesWith(zone).map((z) => (
              <option key={z} value={z}>
                {z.replaceAll('_', ' ')} ({offsetLabel(nowMs, z)})
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)]">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 id={headingId} className="text-sm font-semibold" aria-live="polite">
              {formatMonthYear(month, locale)}
            </h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => go(-1)}
                disabled={prevDisabled}
                aria-label={t('previousMonth')}
                className="flex size-8 items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeftIcon className={flip} />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={nextDisabled}
                aria-label={t('nextMonth')}
                className="flex size-8 items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-40"
              >
                <ChevronRightIcon className={flip} />
              </button>
            </div>
          </div>
          <div
            role="grid"
            aria-labelledby={headingId}
            aria-busy={q.isFetching}
            className="relative"
          >
            <div role="row" className="grid grid-cols-7 text-center text-xs text-muted-foreground">
              {heads.map((w) => (
                <div
                  key={w}
                  role="columnheader"
                  aria-label={weekdayLabel(w, locale, 'long')}
                  className="py-1"
                >
                  {weekdayLabel(w, locale, 'short')}
                </div>
              ))}
            </div>
            {rows.map((row) => (
              <div key={row[0]!.day} role="row" className="grid grid-cols-7 gap-1 py-0.5">
                {row.map((cell) => {
                  const n = cell.inMonth ? (byDay.get(cell.day)?.length ?? 0) : 0;
                  const selected = day === cell.day;
                  const label = formatDayKey(cell.day, locale, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  });
                  return (
                    <div key={cell.day} role="gridcell" className="flex justify-center">
                      <button
                        type="button"
                        disabled={n === 0}
                        aria-pressed={selected}
                        aria-label={
                          n > 0 ? `${label}, ${t('timesAvailable', { count: n })}` : label
                        }
                        onClick={() => {
                          setDay(cell.day);
                          p.onChange(null);
                        }}
                        className={cn(
                          'relative flex size-10 items-center justify-center rounded-full text-sm outline-none transition',
                          'focus-visible:ring-2 focus-visible:ring-primary',
                          !cell.inMonth && 'invisible',
                          n > 0 &&
                            !selected &&
                            'bg-brand/10 font-semibold text-primary hover:bg-brand/20',
                          n === 0 && 'cursor-default text-muted-foreground/60',
                          selected && 'bg-brand font-semibold text-brand-foreground',
                          cell.day === today && !selected && 'ring-1 ring-border',
                        )}
                      >
                        {Number(cell.day.slice(8))}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
            {q.isFetching && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Spinner label={t('loading')} />
              </div>
            )}
          </div>
          {p.typeZone && p.typeZone !== zone && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('typeZone', { zone: p.typeZone.replaceAll('_', ' ') })}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <h3 className="mb-2 text-sm font-semibold">
            {day
              ? formatDayKey(day, locale, { weekday: 'long', day: 'numeric', month: 'short' })
              : t('pickDay')}
          </h3>
          {q.isError ? (
            <div role="alert" className="space-y-2 text-sm text-danger">
              <p>{errorKind(q.error) === 'rateLimited' ? t('rateLimited') : t('loadFailed')}</p>
              <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
                {t('retry')}
              </Button>
            </div>
          ) : q.isSuccess && groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noTimes')}</p>
          ) : day && times.length === 0 && q.isSuccess ? (
            <p className="text-sm text-muted-foreground">{t('noTimesDay')}</p>
          ) : (
            <ul
              className="thin-scrollbar flex max-h-72 flex-col gap-2 overflow-y-auto pe-1"
              aria-label={t('times')}
            >
              {times.map((s) => {
                const selected = p.value !== null && Date.parse(p.value) === Date.parse(s.start);
                const blocked = p.disabledStart
                  ? Date.parse(p.disabledStart) === Date.parse(s.start)
                  : false;
                const left = s.remaining ?? null;
                return (
                  <li key={s.start}>
                    <button
                      type="button"
                      disabled={blocked}
                      aria-pressed={selected}
                      onClick={() => p.onChange(s)}
                      className={cn(
                        'flex h-10 w-full items-center justify-center gap-2 rounded-md border text-sm font-medium outline-none transition',
                        'focus-visible:ring-2 focus-visible:ring-primary',
                        selected
                          ? 'border-brand bg-brand text-brand-foreground'
                          : 'border-brand/40 text-primary hover:bg-brand/10',
                        blocked && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      {formatTime(s.start, locale, zone)}
                      {left !== null && left > 1 && left <= 5 && (
                        <span
                          className={cn(
                            'text-xs font-normal',
                            selected ? 'opacity-90' : 'text-muted-foreground',
                          )}
                        >
                          {t('seatsLeft', { count: left })}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** The zone label for a heading ("Asia/Kolkata (GMT+5:30)"). */
export function zoneTitle(zone: string, at: number): string {
  return `${zone.replaceAll('_', ' ')} (${offsetLabel(at, zone)})`;
}
