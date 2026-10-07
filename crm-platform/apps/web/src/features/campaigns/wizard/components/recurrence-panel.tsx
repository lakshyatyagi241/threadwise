'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import {
  RECURRENCE_AFTER_MAX,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_INTERVAL_MAX,
  effectiveMonthDay,
  upcomingOccurrences,
  type RecurrenceFrequency,
  type RecurrenceRule,
} from '@crm/contracts';
import { Alert, Field, Input, Select, cn } from '@crm/ui';
import { issueFor, type StepIssue } from '../lib/issues';
import { ruleWithFrequency, timeZoneOptions, toggleWeekday, validRule } from '../lib/schedule';
import { ChoiceCard } from './parts';
import { useScheduleWords } from './use-words';

const ENDS = ['never', 'on_date', 'after'] as const;
const NEXT_RUNS = 5;

/** The recurring broadcast's rule: a sentence that says what it will do, the fields, and the next five runs. */
export function RecurrencePanel({
  rule,
  issues,
  disabled,
  onRule,
}: {
  rule: RecurrenceRule;
  issues: StepIssue[];
  disabled?: boolean;
  onRule: (rule: RecurrenceRule) => void;
}) {
  const t = useTranslations('campaigns.wizard.send');
  const ti = useTranslations('campaigns.wizard.issues');
  const words = useScheduleWords();
  const uid = useId();
  const valid = validRule(rule);
  const startIssue = issueFor(issues, 'schedule.rule.startDate');
  const ruleIssue = issueFor(issues, 'schedule.rule');
  const runs = valid ? upcomingOccurrences(valid, NEXT_RUNS) : [];
  const patch = (p: Partial<RecurrenceRule>) => onRule({ ...rule, ...p });

  return (
    <div className="space-y-4 rounded-lg border border-border p-3">
      <div
        aria-live="polite"
        className="rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-sm"
        data-testid="recurrence-banner"
      >
        {valid ? (
          words.recurrence(valid)
        ) : (
          <span className="text-muted-foreground">{t('ruleIncomplete')}</span>
        )}
      </div>
      {ruleIssue && <Alert tone="danger">{ti(ruleIssue.code)}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label={t('startDate')}
          htmlFor={`${uid}-start`}
          error={startIssue ? ti(startIssue.code) : undefined}
        >
          <Input
            id={`${uid}-start`}
            type="date"
            value={rule.startDate}
            disabled={disabled}
            invalid={Boolean(startIssue)}
            onChange={(e) => patch({ startDate: e.target.value })}
          />
        </Field>
        <Field label={t('timeOfDay')} htmlFor={`${uid}-time`}>
          <Input
            id={`${uid}-time`}
            type="time"
            value={rule.timeOfDay}
            disabled={disabled}
            onChange={(e) => patch({ timeOfDay: e.target.value })}
          />
        </Field>
        <Field label={t('timezone')} htmlFor={`${uid}-zone`}>
          <Select
            id={`${uid}-zone`}
            value={rule.timezone}
            disabled={disabled}
            onChange={(e) => patch({ timezone: e.target.value })}
          >
            {timeZoneOptions(rule.timezone).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('frequency')} htmlFor={`${uid}-freq`}>
          <Select
            id={`${uid}-freq`}
            value={rule.frequency}
            disabled={disabled}
            onChange={(e) => onRule(ruleWithFrequency(rule, e.target.value as RecurrenceFrequency))}
          >
            {RECURRENCE_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {t(`freq.${f}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('repeatEvery')} htmlFor={`${uid}-every`}>
          <div className="flex items-center gap-2">
            <Input
              id={`${uid}-every`}
              type="number"
              min={1}
              max={RECURRENCE_INTERVAL_MAX}
              value={rule.interval || ''}
              disabled={disabled}
              invalid={rule.interval < 1}
              className="w-24"
              onChange={(e) => patch({ interval: Math.trunc(Number(e.target.value)) || 0 })}
            />
            <span className="text-sm text-muted-foreground">
              {t(`unit.${rule.frequency}`, { count: Math.max(1, rule.interval) })}
            </span>
          </div>
        </Field>
      </div>

      {rule.frequency === 'weekly' && (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t('onTheseDays')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => {
              const on = rule.weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  aria-label={words.weekday(d, 'long')}
                  title={words.weekday(d, 'long')}
                  disabled={disabled}
                  onClick={() => onRule(toggleWeekday(rule, d))}
                  className={cn(
                    'grid size-9 place-items-center rounded-full border text-sm font-medium outline-none transition',
                    'focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50',
                    on
                      ? 'border-brand bg-brand text-brand-foreground'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  {words.weekday(d, 'narrow')}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t('weekdaysHint')}</p>
        </fieldset>
      )}

      {rule.frequency === 'monthly' && (
        <Field
          label={t('monthDay')}
          htmlFor={`${uid}-mday`}
          hint={t('monthDayHint', { day: effectiveMonthDay(rule) })}
        >
          <Input
            id={`${uid}-mday`}
            type="number"
            min={1}
            max={31}
            value={rule.monthDay ?? ''}
            placeholder={String(effectiveMonthDay(rule))}
            disabled={disabled}
            className="w-24"
            onChange={(e) =>
              patch({ monthDay: e.target.value ? Math.trunc(Number(e.target.value)) : null })
            }
          />
        </Field>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('ends')}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {ENDS.map((k) => (
            <ChoiceCard
              key={k}
              type="radio"
              name={`${uid}-ends`}
              checked={rule.ends.kind === k}
              disabled={disabled}
              onChange={() =>
                patch({
                  ends:
                    k === 'never'
                      ? { kind: 'never' }
                      : k === 'on_date'
                        ? { kind: 'on_date', date: rule.startDate }
                        : { kind: 'after', occurrences: 10 },
                })
              }
              className="py-2"
            >
              {t(`endsKind.${k}`)}
            </ChoiceCard>
          ))}
        </div>
        {rule.ends.kind === 'on_date' && (
          <Field label={t('endDate')} htmlFor={`${uid}-endd`}>
            <Input
              id={`${uid}-endd`}
              type="date"
              value={rule.ends.date}
              min={rule.startDate}
              disabled={disabled}
              onChange={(e) => patch({ ends: { kind: 'on_date', date: e.target.value } })}
            />
          </Field>
        )}
        {rule.ends.kind === 'after' && (
          <Field label={t('endAfter')} htmlFor={`${uid}-enda`}>
            <Input
              id={`${uid}-enda`}
              type="number"
              min={1}
              max={RECURRENCE_AFTER_MAX}
              value={rule.ends.occurrences || ''}
              disabled={disabled}
              className="w-28"
              onChange={(e) =>
                patch({
                  ends: { kind: 'after', occurrences: Math.trunc(Number(e.target.value)) || 0 },
                })
              }
            />
          </Field>
        )}
      </fieldset>

      <div>
        <h3 className="text-sm font-semibold">{t('nextRuns')}</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {valid ? t('noRuns') : t('ruleIncomplete')}
          </p>
        ) : (
          <ol className="mt-1 list-decimal space-y-0.5 ps-5 text-sm">
            {runs.map((o) => (
              <li key={o.index}>{words.instant(o.at, rule.timezone)}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
