'use client';

import { useTranslations } from 'next-intl';
import { Field, Input } from '@crm/ui';
import { parseScoreInput } from '../lib/score';

/**
 * The lead score box of the contact form. Typing a score makes it the person's own: the AI stops changing it. Clearing it hands
 * the contact back to the AI. (The form sends the score only when it changed, so saving something else never turns an AI score
 * into a manual one.)
 */
export function LeadScoreField({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  const t = useTranslations('lead-scoring.field');
  return (
    <Field
      label={t('label')}
      htmlFor={id}
      hint={t('hint')}
      error={invalid ? t('invalid') : undefined}
    >
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={3}
        value={value}
        invalid={invalid}
        placeholder={t('placeholder')}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** True when the box holds something that is not a whole number from 0 to 100. */
export const isScoreInvalid = (text: string): boolean => parseScoreInput(text).kind === 'invalid';
