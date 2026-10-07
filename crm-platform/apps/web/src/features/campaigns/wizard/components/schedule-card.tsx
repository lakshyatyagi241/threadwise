'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { dateInZone, type WizardSchedule } from '@crm/contracts';
import { Field, Select } from '@crm/ui';
import { issueFor, type StepIssue } from '../lib/issues';
import { scheduleForMode, timeZoneOptions } from '../lib/schedule';
import { ChoiceCard, WizardCard } from './parts';
import { RecurrencePanel } from './recurrence-panel';
import { DatePicker, TimePicker } from './pickers';

const MODES = ['now', 'scheduled', 'recurring'] as const;

/** "When to send": Broadcast now, Schedule Broadcast or Recurring Broadcast, with the fields of the chosen one. */
export function ScheduleCard({
  schedule,
  zone,
  issues,
  disabled,
  onSchedule,
}: {
  schedule: WizardSchedule;
  /** The workspace's zone: where a new schedule starts. */
  zone: string;
  issues: StepIssue[];
  disabled?: boolean;
  onSchedule: (s: WizardSchedule) => void;
}) {
  const t = useTranslations('campaigns.wizard.send');
  const ti = useTranslations('campaigns.wizard.issues');
  const uid = useId();
  const dateIssue = issueFor(issues, 'schedule.date');
  const now = new Date();
  return (
    <WizardCard title={t('whenTitle')} id="send-when">
      <div className="space-y-4">
        <div role="radiogroup" aria-label={t('whenTitle')} className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <ChoiceCard
              key={m}
              type="radio"
              name={`${uid}-mode`}
              checked={schedule.mode === m}
              disabled={disabled}
              onChange={() => onSchedule(scheduleForMode(m, schedule, zone, now))}
            >
              <span className="block font-medium">{t(`mode.${m}`)}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t(`modeHint.${m}`)}
              </span>
            </ChoiceCard>
          ))}
        </div>

        {schedule.mode === 'scheduled' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label={t('date')}
              htmlFor={`${uid}-date`}
              error={dateIssue ? ti(dateIssue.code) : undefined}
            >
              <DatePicker
                id={`${uid}-date`}
                value={schedule.date}
                min={safeToday(schedule.timezone, now)}
                disabled={disabled}
                invalid={Boolean(dateIssue)}
                onChange={(date) => onSchedule({ ...schedule, date })}
              />
            </Field>
            <Field label={t('time')} htmlFor={`${uid}-time`}>
              <TimePicker
                id={`${uid}-time`}
                value={schedule.time}
                disabled={disabled}
                invalid={Boolean(dateIssue)}
                onChange={(time) => onSchedule({ ...schedule, time })}
              />
            </Field>
            <Field label={t('timezone')} htmlFor={`${uid}-zone`}>
              <Select
                id={`${uid}-zone`}
                value={schedule.timezone}
                disabled={disabled}
                onChange={(e) => onSchedule({ ...schedule, timezone: e.target.value })}
              >
                {timeZoneOptions(schedule.timezone).map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {schedule.mode === 'recurring' && (
          <RecurrencePanel
            rule={schedule.rule}
            issues={issues}
            disabled={disabled}
            onRule={(rule) => onSchedule({ mode: 'recurring', rule })}
          />
        )}

        <details className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {t('explainerTitle')}
          </summary>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-muted-foreground">
            <li>{t('explainerNow')}</li>
            <li>{t('explainerScheduled')}</li>
            <li>{t('explainerRecurring')}</li>
          </ul>
        </details>
      </div>
    </WizardCard>
  );
}

function safeToday(zone: string, now: Date): string | undefined {
  try {
    return dateInZone(now, zone);
  } catch {
    return undefined;
  }
}
