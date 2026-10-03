'use client';

import { useTranslations } from 'next-intl';
import { Checkbox, Field, Input, PasswordInput, Select } from '@crm/ui';
import {
  canClear,
  credentialDisplay,
  fieldId,
  type CredentialState,
  type FieldProblem,
  type FieldValues,
  type FormMode,
  type SetupField,
} from '../lib/setup-form';

/**
 * The inputs of an integration's setup form, one per `authFields` entry. Secrets are write-only password fields: nothing the API
 * stored is ever put in one, and under them only "set, ends in ####" is said. A plain text field shows its stored value.
 */
export function SetupFields({
  fields,
  values,
  onChange,
  problems,
  serverFields,
  mode,
  states,
  cleared,
  onToggleClear,
  idPrefix,
  disabled,
}: {
  fields: readonly SetupField[];
  values: FieldValues;
  onChange: (key: string, value: string) => void;
  problems: Record<string, FieldProblem>;
  /** Field-level problems the API returned, by field key (the text is not shown; the field is marked). */
  serverFields?: Record<string, string>;
  mode: FormMode;
  states?: readonly CredentialState[];
  cleared?: ReadonlySet<string>;
  onToggleClear?: (key: string, clear: boolean) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const t = useTranslations('marketplace.setup');
  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const id = fieldId(idPrefix, f.key);
        const state = states?.find((s) => s.key === f.key);
        const isCleared = cleared?.has(f.key) ?? false;
        const problem = problems[f.key];
        const serverProblem = serverFields?.[f.key];
        const error = problem
          ? t(`problems.${problem}`, { label: f.label })
          : serverProblem
            ? t('problems.server', { label: f.label })
            : undefined;
        const display = mode === 'edit' ? credentialDisplay(state) : null;
        const label = f.required ? f.label : t('optionalLabel', { label: f.label });
        const stored = display && (
          <span data-testid={`stored-${f.key}`}>
            {display.kind === 'notSet' && t('stored.notSet')}
            {display.kind === 'endsIn' && t('stored.endsIn', { last: display.last })}
            {display.kind === 'value' && t('stored.value')}
            {display.kind === 'setNoHint' && t('stored.set')}
          </span>
        );
        const hint = (
          <>
            {f.help && <span className="block">{f.help}</span>}
            {f.kind === 'secret' && mode === 'edit' && state?.isSet && (
              <span className="block">{t('keepBlank')}</span>
            )}
            {stored && <span className="block">{stored}</span>}
          </>
        );
        return (
          <div key={f.key} className="space-y-2">
            <Field label={label} htmlFor={id} hint={hint} error={error}>
              {f.kind === 'secret' ? (
                <PasswordInput
                  id={id}
                  name={`cred-${f.key}`}
                  value={isCleared ? '' : (values[f.key] ?? '')}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  placeholder={f.placeholder ?? undefined}
                  autoComplete="off"
                  spellCheck={false}
                  invalid={Boolean(error)}
                  disabled={disabled || isCleared}
                  required={f.required && !(mode === 'edit' && state?.isSet)}
                  showLabel={t('show')}
                  hideLabel={t('hide')}
                />
              ) : f.kind === 'select' ? (
                <Select
                  id={id}
                  value={isCleared ? '' : (values[f.key] ?? '')}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  invalid={Boolean(error)}
                  disabled={disabled || isCleared}
                  required={f.required}
                >
                  <option value="">{t('choose')}</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={id}
                  value={isCleared ? '' : (values[f.key] ?? '')}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  placeholder={f.placeholder ?? undefined}
                  autoComplete="off"
                  invalid={Boolean(error)}
                  disabled={disabled || isCleared}
                  required={f.required}
                />
              )}
            </Field>
            {mode === 'edit' && onToggleClear && canClear(f, states) && (
              <Checkbox
                id={`${id}-clear`}
                label={t('clear', { label: f.label })}
                checked={isCleared}
                disabled={disabled}
                onChange={(e) => onToggleClear(f.key, e.target.checked)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
