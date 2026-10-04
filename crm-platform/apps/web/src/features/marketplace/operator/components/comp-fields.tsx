'use client';

import { useTranslations } from 'next-intl';
import { Field, Input, Textarea } from '@crm/ui';
import type { TextRule } from '../lib/confirmations';
import {
  COMP_MONTHS_MAX,
  OPERATOR_NOTE_MAX,
  OPERATOR_NOTE_MIN,
  parseMonths,
  type CompDuration,
} from '../lib/subscriptions';

const NS = 'marketplace.operator.compFields';

/** "For a number of months" or "Until I end it": the two ways a comp can run. Shared by the comp dialog and the comp-existing-users dialog. */
export function DurationField({
  id,
  duration,
  months,
  disabled,
  onChange,
}: {
  id: string;
  duration: CompDuration;
  months: string;
  disabled?: boolean;
  onChange: (next: { duration: CompDuration; months: string }) => void;
}) {
  const t = useTranslations(NS);
  const invalid = duration === 'months' && parseMonths(months) === null;
  return (
    <fieldset className="min-w-0 space-y-2 text-sm" disabled={disabled}>
      <legend className="mb-1 font-medium">{t('duration')}</legend>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name={`${id}-duration`}
          className="size-4 accent-[var(--primary)]"
          checked={duration === 'months'}
          onChange={() => onChange({ duration: 'months', months })}
        />
        {t('months')}
      </label>
      {duration === 'months' && (
        <Field
          label={t('monthsLabel')}
          htmlFor={`${id}-months`}
          hint={t('monthsHint', { max: COMP_MONTHS_MAX })}
          error={invalid ? t('monthsInvalid', { max: COMP_MONTHS_MAX }) : undefined}
          className="ps-6"
        >
          <Input
            id={`${id}-months`}
            type="number"
            inputMode="numeric"
            min={1}
            max={COMP_MONTHS_MAX}
            step={1}
            className="max-w-32"
            value={months}
            invalid={invalid}
            onChange={(e) => onChange({ duration, months: e.target.value })}
          />
        </Field>
      )}
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          name={`${id}-duration`}
          className="size-4 accent-[var(--primary)]"
          checked={duration === 'open'}
          onChange={() => onChange({ duration: 'open', months })}
        />
        {t('open')}
      </label>
    </fieldset>
  );
}

/** The required note of a comp or a cancellation: 5 to 300 characters, kept in the audit trail. */
export function NoteField({
  id,
  label,
  value,
  rule,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  rule: TextRule;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const t = useTranslations(NS);
  return (
    <div className="space-y-1">
      <Field
        label={label}
        htmlFor={id}
        hint={t('noteHint', { min: OPERATOR_NOTE_MIN, max: OPERATOR_NOTE_MAX })}
      >
        <Textarea
          id={id}
          rows={3}
          value={value}
          disabled={disabled}
          invalid={rule.tooLong}
          aria-describedby={`${id}-count`}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      <p
        id={`${id}-count`}
        className={`text-xs tabular-nums ${rule.ok || rule.length === 0 ? 'text-muted-foreground' : 'text-danger'}`}
        aria-live="polite"
      >
        {t('count', { count: rule.length, min: OPERATOR_NOTE_MIN, max: OPERATOR_NOTE_MAX })}
      </p>
    </div>
  );
}
