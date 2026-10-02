'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type CSSProperties } from 'react';
import { cn } from '@crm/ui';
import type { Appointment } from '../api/schemas';
import {
  customerLabel,
  formatDayKey,
  formatHour,
  formatTime,
  formatTimeRange,
  safeColor,
  weekdayLabel,
} from '../lib/format';
import { monthMatrix, weekdayOrder } from '../lib/slots';
import { eventBox, eventsOnDay, hourRange, layoutDay, nowMinutes } from '../lib/week-grid';
import { dayKeyOf } from '../lib/zone';
import { TypeDot } from './parts';

/** A booking's block colour: the type's colour as a left edge and a light wash of it behind the text (works in both themes). */
function blockStyle(color: string | null | undefined): CSSProperties {
  const c = safeColor(color);
  return {
    borderInlineStartColor: c,
    backgroundColor: `color-mix(in srgb, ${c} 16%, var(--background))`,
  };
}

const HOUR_PX = 64;

interface CalendarCommon {
  appointments: readonly Appointment[];
  zone: string;
  now: Date;
  activeId: string | null;
  onOpen: (id: string) => void;
}

function describe(a: Appointment, locale: string, zone: string): string {
  return [
    customerLabel(a.customer),
    a.bookingType?.name,
    formatTimeRange(a.startsAt, a.endsAt, locale, zone),
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * The week view: seven day columns on an hour grid in the display zone, each booking a block sized by its length. Bookings that
 * overlap sit side by side. The hours shown are the working day widened to take in every booking of the week. A line marks now
 * in today's column. On a narrow screen the grid scrolls sideways inside its card.
 */
export function CalendarWeek(p: CalendarCommon & { days: readonly string[] }) {
  const t = useTranslations('appointments.calendar');
  const locale = useLocale();
  const today = dayKeyOf(p.now, p.zone);
  const range = useMemo(
    () => hourRange(p.appointments, p.days, p.zone),
    [p.appointments, p.days, p.zone],
  );
  const hours = Array.from({ length: range.to - range.from }, (_, i) => range.from + i);
  const height = hours.length * HOUR_PX;

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-auto">
      <div style={{ minWidth: 760 }} className="relative">
        <div className="sticky top-0 z-20 grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border bg-muted">
          <div />
          {p.days.map((d) => {
            const isToday = d === today;
            return (
              <div key={d} className="border-s border-border px-2 py-2 text-center">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {formatDayKey(d, locale, { weekday: 'short' })}
                </div>
                <div
                  className={cn(
                    'mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-sm font-semibold',
                    isToday && 'bg-brand text-brand-foreground',
                  )}
                >
                  {Number(d.slice(8))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]" style={{ height }}>
          <div className="relative">
            {hours.map((h, i) => (
              <div
                key={h}
                style={{ top: i * HOUR_PX }}
                className="absolute end-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground first:hidden"
              >
                {formatHour(h, locale)}
              </div>
            ))}
          </div>
          {p.days.map((d) => {
            const placed = layoutDay(p.appointments, d, p.zone);
            const nowAt = nowMinutes(p.now, d, p.zone);
            return (
              <div
                key={d}
                className={cn('relative border-s border-border', d === today && 'bg-brand/[0.03]')}
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--border) ${HOUR_PX - 1}px, var(--border) ${HOUR_PX}px)`,
                }}
              >
                {placed.map((e) => {
                  const a = e.event;
                  const box = eventBox(e, range);
                  const width = 100 / e.cols;
                  const done = a.status === 'cancelled' || a.status === 'no_show';
                  const compact = e.endMin - e.startMin <= 35;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => p.onOpen(a.id)}
                      aria-label={describe(a, locale, p.zone)}
                      aria-current={p.activeId === a.id ? 'true' : undefined}
                      title={describe(a, locale, p.zone)}
                      style={{
                        ...blockStyle(a.bookingType?.color),
                        top: `${box.top}%`,
                        height: `${box.height}%`,
                        insetInlineStart: `calc(${e.col * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      }}
                      className={cn(
                        'absolute overflow-hidden rounded-md border border-s-4 border-border px-1.5 py-0.5 text-start text-xs leading-tight outline-none transition hover:brightness-95 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary',
                        a.status === 'pending' && 'border-dashed',
                        done && 'opacity-60',
                        p.activeId === a.id && 'z-10 ring-2 ring-primary',
                      )}
                    >
                      {compact ? (
                        <span className="flex items-center gap-1.5 truncate">
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatTime(a.startsAt, locale, p.zone)}
                          </span>
                          <span className={cn('truncate font-semibold', done && 'line-through')}>
                            {customerLabel(a.customer) || a.title}
                          </span>
                        </span>
                      ) : (
                        <>
                          <span
                            className={cn('block truncate font-semibold', done && 'line-through')}
                          >
                            {customerLabel(a.customer) || a.title}
                          </span>
                          <span className="block truncate tabular-nums text-muted-foreground">
                            {formatTime(a.startsAt, locale, p.zone)}
                          </span>
                          {box.height > 9 && (
                            <span className="block truncate text-muted-foreground">
                              {a.bookingType?.name}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
                {nowAt !== null && nowAt >= range.from * 60 && nowAt <= range.to * 60 && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-danger"
                    style={{
                      top: `${((nowAt - range.from * 60) / ((range.to - range.from) * 60)) * 100}%`,
                    }}
                  >
                    <span className="absolute -start-1 -top-[5px] size-2 rounded-full bg-danger" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {p.appointments.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('emptyWeek')}</p>
      )}
    </div>
  );
}

const MAX_CHIPS = 3;

/**
 * The month view: whole weeks around the month; each day lists up to three bookings and "+N more", which opens that week.
 * Below the medium breakpoint the cells show dots only (no room for text) and tapping a day lists its bookings underneath.
 */
export function CalendarMonth(
  p: CalendarCommon & {
    /** Any day of the month shown. */
    anchor: string;
    weekStartsOn: number;
    onShowDay: (day: string) => void;
  },
) {
  const t = useTranslations('appointments.calendar');
  const locale = useLocale();
  const today = dayKeyOf(p.now, p.zone);
  const rows = useMemo(() => monthMatrix(p.anchor, p.weekStartsOn), [p.anchor, p.weekStartsOn]);
  const month = p.anchor.slice(0, 7);
  const [picked, setPicked] = useState<string | null>(null);
  const selected =
    picked && picked.startsWith(month) ? picked : today.startsWith(month) ? today : `${month}-01`;
  const agenda = eventsOnDay(p.appointments, selected, p.zone);

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-auto">
      <div role="grid" aria-label={t('monthGrid')}>
        <div
          role="row"
          className="sticky top-0 z-10 grid grid-cols-7 border-b border-border bg-muted text-center text-xs uppercase tracking-wide text-muted-foreground"
        >
          {weekdayOrder(p.weekStartsOn).map((w) => (
            <div
              key={w}
              role="columnheader"
              aria-label={weekdayLabel(w, locale, 'long')}
              className="py-2"
            >
              {weekdayLabel(w, locale, 'short')}
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row[0]!.day} role="row" className="grid grid-cols-7">
            {row.map((cell) => {
              const list = eventsOnDay(p.appointments, cell.day, p.zone);
              const isToday = cell.day === today;
              const extra = list.length - MAX_CHIPS;
              return (
                <div
                  key={cell.day}
                  role="gridcell"
                  aria-selected={selected === cell.day}
                  className={cn(
                    'min-h-16 border-b border-s border-border p-1 md:min-h-28 md:p-1.5',
                    !cell.inMonth && 'bg-muted/40 text-muted-foreground',
                    selected === cell.day && 'bg-brand/[0.06] md:bg-transparent',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(cell.day);
                        if (window.matchMedia('(min-width: 768px)').matches) p.onShowDay(cell.day);
                      }}
                      aria-label={formatDayKey(cell.day, locale, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}
                      className={cn(
                        'flex size-6 items-center justify-center rounded-full text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        isToday ? 'bg-brand text-brand-foreground' : 'hover:bg-muted',
                      )}
                    >
                      {Number(cell.day.slice(8))}
                    </button>
                  </div>
                  <ul className="mt-1 hidden space-y-1 md:block">
                    {list.slice(0, MAX_CHIPS).map((a) => {
                      const done = a.status === 'cancelled' || a.status === 'no_show';
                      return (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => p.onOpen(a.id)}
                            title={describe(a, locale, p.zone)}
                            aria-label={describe(a, locale, p.zone)}
                            style={blockStyle(a.bookingType?.color)}
                            className={cn(
                              'flex w-full items-center gap-1 truncate rounded border border-s-[3px] border-border px-1 py-0.5 text-start text-[11px] leading-tight outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-primary',
                              a.status === 'pending' && 'border-dashed',
                              done && 'opacity-60 line-through',
                              p.activeId === a.id && 'ring-2 ring-primary',
                            )}
                          >
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {formatTime(a.startsAt, locale, p.zone)}
                            </span>
                            <span className="truncate font-medium">
                              {customerLabel(a.customer) || a.title}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                    {extra > 0 && (
                      <li>
                        <button
                          type="button"
                          onClick={() => p.onShowDay(cell.day)}
                          className="px-1 text-[11px] font-medium text-brand hover:underline dark:text-primary"
                        >
                          {t('more', { count: extra })}
                        </button>
                      </li>
                    )}
                  </ul>
                  {list.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-0.5 md:hidden" aria-hidden="true">
                      {list.slice(0, 4).map((a) => (
                        <TypeDot key={a.id} color={a.bookingType?.color} className="size-1.5" />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <section aria-label={t('dayAgenda')} className="border-t border-border p-3 md:hidden">
        <h3 className="mb-2 text-sm font-semibold">
          {formatDayKey(selected, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
        </h3>
        {agenda.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('emptyDay')}</p>
        ) : (
          <ul className="space-y-2">
            {agenda.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => p.onOpen(a.id)}
                  style={blockStyle(a.bookingType?.color)}
                  className="flex w-full items-center justify-between gap-3 rounded-md border border-s-4 border-border px-3 py-2 text-start text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {customerLabel(a.customer) || a.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.bookingType?.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatTime(a.startsAt, locale, p.zone)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
