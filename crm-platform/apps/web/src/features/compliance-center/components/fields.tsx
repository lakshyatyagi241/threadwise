'use client';

import { useTranslations } from 'next-intl';
import { Field, Input } from '@crm/ui';
import { problemFor, type Problem, type SettingsForm } from '../lib/model';

export const CARD = 'rounded-xl border border-border bg-background p-4';

/** A labelled https link input. `problem` is the form's problem key for the field, if any. */
export function UrlField({
  id,
  label,
  hint,
  value,
  onChange,
  problem,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  problem?: Problem['key'];
  disabled?: boolean;
}) {
  const t = useTranslations('compliance-center.problems');
  return (
    <Field label={label} htmlFor={id} hint={hint} error={problem ? t(problem) : undefined}>
      <Input
        id={id}
        type="url"
        inputMode="url"
        dir="ltr"
        placeholder="https://"
        value={value}
        disabled={disabled}
        invalid={problem !== undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** Name, email, phone and address of an officer. */
export function OfficerFields({
  idPrefix,
  value,
  onChange,
  problems,
  path,
  disabled,
}: {
  idPrefix: string;
  value: SettingsForm['dpo'];
  onChange: (v: SettingsForm['dpo']) => void;
  problems: Problem[];
  /** The form path of the block, `dpo` or `grievanceOfficer`. */
  path: string;
  disabled?: boolean;
}) {
  const t = useTranslations('compliance-center.contacts.officer');
  const tp = useTranslations('compliance-center.problems');
  const emailProblem = problemFor(problems, `${path}.email`);
  const set = (p: Partial<SettingsForm['dpo']>) => onChange({ ...value, ...p });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('name')} htmlFor={`${idPrefix}-name`}>
        <Input
          id={`${idPrefix}-name`}
          value={value.name}
          maxLength={120}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>
      <Field
        label={t('email')}
        htmlFor={`${idPrefix}-email`}
        error={emailProblem ? tp(emailProblem) : undefined}
      >
        <Input
          id={`${idPrefix}-email`}
          type="email"
          dir="ltr"
          value={value.email}
          maxLength={200}
          disabled={disabled}
          invalid={emailProblem !== undefined}
          autoComplete="off"
          onChange={(e) => set({ email: e.target.value })}
        />
      </Field>
      <Field label={t('phone')} htmlFor={`${idPrefix}-phone`}>
        <Input
          id={`${idPrefix}-phone`}
          type="tel"
          dir="ltr"
          value={value.phone}
          maxLength={40}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => set({ phone: e.target.value })}
        />
      </Field>
      <Field label={t('address')} htmlFor={`${idPrefix}-address`}>
        <Input
          id={`${idPrefix}-address`}
          value={value.address}
          maxLength={300}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => set({ address: e.target.value })}
        />
      </Field>
    </div>
  );
}
