'use client';

import { useTranslations } from 'next-intl';
import { Field, Select } from '@crm/ui';
import type { TaskOutcomeRef } from '../api/schemas';
import { useTaskOutcomes } from '../api/hooks';
import { outcomeChoices } from '../lib/outcomes';

/**
 * The picker for a task's outcome: the workspace's active outcomes, "No outcome", and the outcome the task already carries when it
 * has since been hidden (so the select still shows what the task has). It draws nothing while the workspace has no outcome and the
 * task has none, because there is nothing to choose (the list is set up in Settings > Task outcomes).
 */
export function OutcomeSelect({
  id,
  label,
  error,
  value,
  current,
  disabled,
  onChange,
  className,
}: {
  id: string;
  /** The field's label (the field is not drawn at all when there is nothing to choose). */
  label: string;
  error?: string;
  /** The picked outcome id, or empty for none. */
  value: string;
  /** The outcome the task has now, if any. */
  current: TaskOutcomeRef | null;
  disabled?: boolean;
  onChange: (outcomeId: string) => void;
  className?: string;
}) {
  const t = useTranslations('tasks.outcomes');
  const outcomes = useTaskOutcomes(true);
  const choices = outcomeChoices(outcomes.data ?? [], current);
  if (choices.length === 0) return null;
  return (
    <Field label={label} htmlFor={id} error={error} className={className}>
      <Select
        id={id}
        disabled={disabled}
        value={value}
        invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t('none')}</option>
        {choices.map((o) => (
          <option key={o.id} value={o.id}>
            {o.isActive ? o.name : t('hiddenName', { name: o.name })}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/**
 * "Complete with outcome": one select that completes an open task with the outcome picked (the quick way to log how a call or a
 * follow-up went). Drawn only when the workspace has outcomes to pick from.
 */
export function CompleteWithOutcome({
  disabled,
  onComplete,
}: {
  disabled?: boolean;
  onComplete: (outcomeId: string) => void;
}) {
  const t = useTranslations('tasks.outcomes');
  const outcomes = useTaskOutcomes(true);
  const list = outcomes.data ?? [];
  if (list.length === 0) return null;
  return (
    <Select
      aria-label={t('completeWith')}
      className="h-9 w-auto min-w-44"
      disabled={disabled}
      value=""
      onChange={(e) => {
        if (e.target.value) onComplete(e.target.value);
      }}
    >
      <option value="">{t('completeWith')}</option>
      {list.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </Select>
  );
}
