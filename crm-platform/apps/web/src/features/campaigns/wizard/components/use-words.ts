'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { RecurrenceRule, WizardSchedule } from '@crm/contracts';
import { dateOnlyToDate, recurrenceFacts, weekdayDate } from '../lib/schedule';

/**
 * Schedules and recurrence rules in words, in the reader's language. The sentences are built from translated messages with plural
 * and ordinal rules (never by joining English fragments); the pieces that vary (list of weekdays, dates) come from `Intl`.
 */
export function useScheduleWords() {
  const t = useTranslations('campaigns.wizard.words');
  const format = useFormatter();
  return useMemo(() => {
    const date = (iso: string) =>
      format.dateTime(dateOnlyToDate(iso), { dateStyle: 'medium', timeZone: 'UTC' });
    const weekday = (n: number, width: 'long' | 'narrow' | 'short' = 'long') =>
      format.dateTime(weekdayDate(n), { weekday: width, timeZone: 'UTC' });
    const instant = (d: Date, zone: string) =>
      format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone });

    const recurrence = (rule: RecurrenceRule): string => {
      const f = recurrenceFacts(rule);
      let cadence = t(`cadence.${f.frequency}`, { count: f.interval });
      if (f.frequency === 'weekly') {
        cadence += t('onDays', { days: format.list(f.weekdays.map((d) => weekday(d))) });
      } else if (f.frequency === 'monthly') {
        cadence += t('onMonthDay', { day: f.monthDay });
      }
      const ends =
        f.ends.kind === 'on_date'
          ? t('endsOnDate', { date: date(f.ends.date) })
          : f.ends.kind === 'after'
            ? t('endsAfter', { count: f.ends.occurrences })
            : '';
      return t('recurrence', {
        cadence,
        time: f.time,
        zone: f.zone,
        start: date(f.startDate),
        ends,
      });
    };

    const schedule = (s: WizardSchedule): string =>
      s.mode === 'now'
        ? t('now')
        : s.mode === 'scheduled'
          ? t('scheduled', { date: date(s.date), time: s.time, zone: s.timezone })
          : recurrence(s.rule);

    return { date, weekday, instant, recurrence, schedule };
  }, [t, format]);
}
