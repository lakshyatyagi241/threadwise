'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { Button, Input, Select, cn } from '@crm/ui';
import {
  MAX_OVERRIDES,
  REASON_MAX,
  addClosedRange,
  dateStatus,
  overrideProblems,
  toggleClosedDay,
  type Override,
} from '../lib/availability';
import { formatDayKey, formatMonthYear, weekdayLabel } from '../lib/format';
import { monthMatrix, weekdayOrder } from '../lib/slots';
import {
  addMonths,
  browserZone,
  dayKeyOf,
  diffDays,
  isValidZone,
  parseDayKey,
  startOfMonth,
} from '../lib/zone';
import { ChevronLeftIcon, ChevronRightIcon, TrashIcon, flip } from './icons';
import { SectionCard, iconButtonClass, useEditor } from './editor-shared';

const MAX_MONTHS_AHEAD = 24;
const timeInput =
  'h-10 w-[7.25rem] rounded-md border bg-background px-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';

/**
 * Date overrides and holidays: a month calendar (a click closes a day, a second click gives it back its weekly hours), a
 * control to close a run of days, and the list of everything that differs from the weekly hours, where a day can also be
 * given its own hours. Days are calendar dates in the booking type's time zone.
 */
export function OverridesSection() {
  const t = useTranslations('appointments.editor.overrides');
  const locale = useLocale();
  const { draft, update, disabled } = useEditor();
  const [nowMs] = useState(() => Date.now());
  const zone = isValidZone(draft.timezone) ? draft.timezone : browserZone();
  const today = dayKeyOf(nowMs, zone);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [rangeError, setRangeError] = useState<'invalid' | 'tooLong' | 'full' | null>(null);
  const headingId = useId();
  const rangeId = useId();

  const weekStartsOn = locale.startsWith('en') && !locale.includes('GB') ? 0 : 1;
  const rows = useMemo(() => monthMatrix(month, weekStartsOn), [month, weekStartsOn]);
  const heads = weekdayOrder(weekStartsOn);
  const overrides = draft.overrides;
  const problems = useMemo(() => overrideProblems(overrides), [overrides]);
  const hasOverride = useMemo(() => new Set(overrides.map((o) => o.date)), [overrides]);
  const lastMonth = addMonths(startOfMonth(today), MAX_MONTHS_AHEAD);
  const setOverrides = (fn: (list: Override[]) => Override[]) =>
    update((d) => ({ ...d, overrides: fn(d.overrides) }));
  const patch = (id: string, change: Partial<Override>) =>
    setOverrides((list) => list.map((o) => (o.id === id ? { ...o, ...change } : o)));
  const atLimit = overrides.length >= MAX_OVERRIDES;

  function closeRange() {
    const a = parseDayKey(from);
    const b = parseDayKey(to || from);
    const end = to || from;
    if (!a || !b || end < from) return setRangeError('invalid');
    if (diffDays(from, end) >= MAX_OVERRIDES) return setRangeError('tooLong');
    if (atLimit) return setRangeError('full');
    setRangeError(null);
    setOverrides((list) => addClosedRange(list, from, end, reason.trim().slice(0, REASON_MAX)));
    setFrom('');
    setTo('');
    setReason('');
  }

  return (
    <SectionCard title={t('title')} hint={t('hint')}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 id={headingId} className="text-sm font-semibold" aria-live="polite">
              {formatMonthYear(month, locale)}
            </h4>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                disabled={month <= startOfMonth(today)}
                aria-label={t('previousMonth')}
                className="flex size-8 items-center justify-center rounded-md border border-border outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
              >
                <ChevronLeftIcon className={flip} />
              </button>
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, 1))}
                disabled={month >= lastMonth}
                aria-label={t('nextMonth')}
                className="flex size-8 items-center justify-center rounded-md border border-border outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
              >
                <ChevronRightIcon className={flip} />
              </button>
            </div>
          </div>
          <div role="grid" aria-labelledby={headingId}>
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
                  const status = dateStatus(cell.day, draft.week, overrides);
                  const past = cell.day < today && !hasOverride.has(cell.day);
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
                        disabled={disabled || past || !cell.inMonth}
                        aria-pressed={status === 'closed'}
                        aria-label={`${label}, ${t(`status.${status}`)}`}
                        title={t(`status.${status}`)}
                        onClick={() => setOverrides((list) => toggleClosedDay(list, cell.day))}
                        className={cn(
                          'relative flex size-9 items-center justify-center rounded-full text-sm outline-none transition',
                          'focus-visible:ring-2 focus-visible:ring-primary',
                          !cell.inMonth && 'invisible',
                          status === 'open' && 'hover:bg-muted',
                          status === 'off' && 'text-muted-foreground/60 hover:bg-muted',
                          status === 'closed' &&
                            'bg-danger/15 font-semibold text-danger line-through hover:bg-danger/25',
                          status === 'custom' &&
                            'bg-brand/10 font-semibold text-brand ring-1 ring-brand/50 hover:bg-brand/20 dark:text-primary',
                          past && 'cursor-default opacity-40 hover:bg-transparent',
                          cell.day === today && status !== 'closed' && 'ring-1 ring-border',
                        )}
                      >
                        {Number(cell.day.slice(8))}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <ul
            className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
            aria-label={t('legend')}
          >
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-3 rounded-full bg-danger/30" />{' '}
              {t('status.closed')}
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-3 rounded-full bg-brand/20 ring-1 ring-brand/50"
              />{' '}
              {t('status.custom')}
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-3 rounded-full bg-muted" /> {t('status.off')}
            </li>
          </ul>
          <p className="mt-1.5 text-xs text-muted-foreground">{t('clickHint')}</p>
        </div>

        <fieldset
          className="min-w-0 space-y-3 self-start rounded-lg border border-border p-3"
          disabled={disabled}
        >
          <legend className="px-1 text-sm font-medium">{t('rangeTitle')}</legend>
          <p className="text-xs text-muted-foreground">{t('rangeHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1 text-sm" htmlFor={`${rangeId}-from`}>
              <span className="font-medium">{t('rangeFrom')}</span>
              <Input
                id={`${rangeId}-from`}
                type="date"
                value={from}
                invalid={rangeError === 'invalid' && !parseDayKey(from)}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setRangeError(null);
                }}
              />
            </label>
            <label className="block space-y-1 text-sm" htmlFor={`${rangeId}-to`}>
              <span className="font-medium">{t('rangeTo')}</span>
              <Input
                id={`${rangeId}-to`}
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => {
                  setTo(e.target.value);
                  setRangeError(null);
                }}
              />
            </label>
          </div>
          <label className="block space-y-1 text-sm" htmlFor={`${rangeId}-reason`}>
            <span className="font-medium">{t('reason')}</span>
            <Input
              id={`${rangeId}-reason`}
              value={reason}
              maxLength={REASON_MAX}
              placeholder={t('reasonPlaceholder')}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {rangeError && (
            <p role="alert" className="text-xs text-danger">
              {t(`rangeProblems.${rangeError}`)}
            </p>
          )}
          <Button variant="secondary" onClick={closeRange} disabled={!from}>
            {t('closeRange')}
          </Button>
        </fieldset>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">{t('listTitle')}</h4>
          <span className="text-xs text-muted-foreground">
            {t('count', { count: overrides.length })}
          </span>
        </div>
        {atLimit && (
          <p className="mb-2 text-xs text-warning">{t('limit', { max: MAX_OVERRIDES })}</p>
        )}
        {overrides.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
            {t('empty')}
          </p>
        ) : (
          <ul className="thin-scrollbar max-h-96 space-y-2 overflow-y-auto pe-1">
            {overrides.map((o) => {
              const problem = problems.get(o.id);
              const day = formatDayKey(o.date, locale, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              });
              return (
                <li key={o.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{day}</span>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setOverrides((list) => list.filter((x) => x.id !== o.id))}
                      aria-label={t('remove', { date: day })}
                      title={t('remove', { date: day })}
                      className={cn(iconButtonClass, 'hover:text-danger')}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Select
                      aria-label={t('mode', { date: day })}
                      value={o.closed ? 'closed' : 'custom'}
                      disabled={disabled}
                      onChange={(e) =>
                        patch(
                          o.id,
                          e.target.value === 'closed'
                            ? { closed: true, from: '', to: '' }
                            : { closed: false, from: o.from || '09:00', to: o.to || '17:00' },
                        )
                      }
                      className="h-10 w-auto min-w-[10rem]"
                    >
                      <option value="closed">{t('modeClosed')}</option>
                      <option value="custom">{t('modeCustom')}</option>
                    </Select>
                    {!o.closed && (
                      <>
                        <input
                          type="time"
                          value={o.from}
                          disabled={disabled}
                          aria-label={t('from', { date: day })}
                          aria-invalid={problem ? true : undefined}
                          onChange={(e) => patch(o.id, { from: e.target.value })}
                          className={cn(timeInput, problem ? 'border-danger' : 'border-border')}
                        />
                        <span aria-hidden="true" className="text-muted-foreground">
                          –
                        </span>
                        <input
                          type="time"
                          value={o.to}
                          disabled={disabled}
                          aria-label={t('to', { date: day })}
                          aria-invalid={problem ? true : undefined}
                          onChange={(e) => patch(o.id, { to: e.target.value })}
                          className={cn(timeInput, problem ? 'border-danger' : 'border-border')}
                        />
                      </>
                    )}
                    <Input
                      value={o.reason}
                      maxLength={REASON_MAX}
                      disabled={disabled}
                      aria-label={t('reasonOf', { date: day })}
                      placeholder={t('reasonPlaceholder')}
                      onChange={(e) => patch(o.id, { reason: e.target.value })}
                      className="min-w-[10rem] flex-1"
                    />
                  </div>
                  {problem && (
                    <p role="alert" className="mt-1.5 text-xs text-danger">
                      {t(`problems.${problem}`)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
