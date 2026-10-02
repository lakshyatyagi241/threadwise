'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { isDay } from '../lib/dates';
import {
  CATCH_UP_MAX,
  missedPeriods,
  previewSchedule,
  scheduleFacts,
  type RecurringForm,
  type ScheduleShape,
} from '../lib/recurring';
import { CalendarIcon } from './icons';
import { Money } from './parts';
import { useEveryText } from './recurring-parts';

/** "Sat, 28 Feb 2026" for a calendar day (never shifted by a time zone). */
function useLongDay() {
  const locale = useLocale();
  return (day: string): string => {
    if (!isDay(day)) return day;
    try {
      return new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${day}T00:00:00Z`));
    } catch {
      return day;
    }
  };
}

/**
 * The next-run preview: a plain sentence for the schedule, the next six dates (with month-end clamping explained), and what stops it.
 * Dates come from the contracts' `upcomingRuns`, the very function the worker runs, so what is shown is what will happen.
 */
export function RecurringPreview({
  shape,
  form,
  today,
  fromIndex = 0,
  catchUp = false,
  amount,
  className,
}: {
  shape: ScheduleShape | null;
  form: Pick<RecurringForm, 'mode' | 'sendChannel'>;
  today: string;
  /** The period the list starts at (edit: the saved next run). */
  fromIndex?: number;
  /** Creating: say how many past periods are made right away. */
  catchUp?: boolean;
  /** What each invoice comes to, when known. */
  amount?: { minor: number; currency: string } | null;
  className?: string;
}) {
  const t = useTranslations('invoicing.recurring.preview');
  const locale = useLocale();
  const every = useEveryText();
  const longDay = useLongDay();
  const preview = previewSchedule(shape, fromIndex);
  const day = (d: string) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${d}T00:00:00Z`));
    } catch {
      return d;
    }
  };

  return (
    <section
      aria-label={t('title')}
      aria-live="polite"
      className={cn('rounded-xl border border-border bg-background', className)}
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <CalendarIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('title')}</h2>
      </header>
      {!shape || !preview ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">{t('incomplete')}</p>
      ) : (
        <div className="space-y-3 px-4 py-4 text-sm">
          <Sentence
            shape={shape}
            form={form}
            every={every(shape.frequency, shape.interval)}
            day={day}
          />
          {amount && amount.minor > 0 && (
            <p className="text-muted-foreground">
              {t('eachInvoice')}{' '}
              <Money
                minor={amount.minor}
                currency={amount.currency}
                className="font-semibold text-foreground"
              />
            </p>
          )}
          {catchUp && isDay(shape.startDate) && shape.startDate < today && (
            <CatchUp shape={shape} today={today} />
          )}
          <ol className="divide-y divide-border rounded-lg border border-border">
            {preview.runs.map((r) => (
              <li key={r.index} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-8 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                  #{r.index + 1}
                </span>
                <span className="font-medium tabular-nums">{longDay(r.date)}</span>
                {r.clamped && (
                  <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                    {t('lastDay')}
                  </span>
                )}
              </li>
            ))}
            {preview.runs.length === 0 && (
              <li className="px-3 py-2 text-muted-foreground">{t('noRuns')}</li>
            )}
          </ol>
          <p className="text-muted-foreground">
            {preview.endedBy === 'maxRuns'
              ? t('endsMaxRuns', { count: shape.maxRuns ?? 0 })
              : preview.endedBy === 'endDate'
                ? t('endsEndDate', {
                    date: shape.endDate ? day(shape.endDate) : '',
                    count: preview.totalRuns ?? 0,
                  })
                : preview.more
                  ? shape.maxRuns !== null || shape.endDate
                    ? t('moreBounded', { count: preview.totalRuns ?? 0 })
                    : t('moreForever')
                  : null}
          </p>
          {preview.clampsAtMonthEnd && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {t('clampNote', { day: Number(shape.startDate.slice(8, 10)) })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Sentence({
  shape,
  form,
  every,
  day,
}: {
  shape: ScheduleShape;
  form: Pick<RecurringForm, 'mode' | 'sendChannel'>;
  every: string;
  day: (d: string) => string;
}) {
  const t = useTranslations('invoicing.recurring.preview');
  const facts = scheduleFacts({ ...form, shape });
  const kind =
    facts.maxRuns !== null && facts.end
      ? 'both'
      : facts.maxRuns !== null
        ? 'runs'
        : facts.end
          ? 'end'
          : 'none';
  const limit = t('sentenceLimit', {
    kind,
    count: facts.maxRuns ?? 0,
    end: facts.end ? day(facts.end) : '',
  });
  return (
    <p className="font-medium leading-relaxed">
      {t('sentence', {
        every,
        start: day(facts.start),
        limit,
        outcome: t(`outcome.${facts.outcome}`),
      })}
    </p>
  );
}

/** A start date in the past: the periods already due are made right away, up to the catch-up cap. */
function CatchUp({ shape, today }: { shape: ScheduleShape; today: string }) {
  const t = useTranslations('invoicing.recurring.preview');
  const missed = missedPeriods(shape, today);
  if (missed === 0) return null;
  return (
    <p
      className={cn(
        'rounded-md px-3 py-2 text-xs',
        missed > CATCH_UP_MAX ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-primary',
      )}
    >
      {missed > CATCH_UP_MAX
        ? t('catchUpTooOld', { count: missed, max: CATCH_UP_MAX })
        : t('catchUp', { count: missed })}
    </p>
  );
}
