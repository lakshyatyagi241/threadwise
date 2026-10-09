'use client';

import { useTranslations } from 'next-intl';
import { API_LIBRARY_VARIABLE_SOURCES, type ApiLibraryVariable } from '@crm/contracts';
import { Input, Select } from '@crm/ui';
import type { FormErrors } from '../lib/form-model';

/**
 * The variables the URL, headers and payload use, each with the default value a test run (and a flow with no value of its own) uses.
 * Rows appear and disappear as `{{tokens}}` are typed, so a default is the only thing to fill in.
 */
export function VariablesPanel({
  variables,
  onChange,
  errors,
  disabled,
}: {
  variables: ApiLibraryVariable[];
  onChange: (next: ApiLibraryVariable[]) => void;
  errors: FormErrors;
  disabled?: boolean;
}) {
  const t = useTranslations('api-library.form.variables');
  if (variables.length === 0) return <p className="text-sm text-muted-foreground">{t('none')}</p>;
  const patch = (i: number, p: Partial<ApiLibraryVariable>) =>
    onChange(variables.map((v, j) => (j === i ? { ...v, ...p } : v)));
  return (
    <ul className="space-y-3">
      {variables.map((v, i) => {
        const err = errors.fields[`variable:${v.name.toLowerCase()}`];
        const id = `alib-var-${i}`;
        return (
          <li key={v.name} className="grid gap-2 sm:grid-cols-[1fr_9rem_1.4fr] sm:items-start">
            <div className="min-w-0 pt-2 font-mono text-sm" dir="ltr" title={v.name}>
              <span className="truncate">{`{{${v.name}}}`}</span>
            </div>
            <Select
              aria-label={t('sourceOf', { name: v.name })}
              value={v.source}
              disabled={disabled}
              onChange={(e) => patch(i, { source: e.target.value as ApiLibraryVariable['source'] })}
            >
              {API_LIBRARY_VARIABLE_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`source.${s}`)}
                </option>
              ))}
            </Select>
            <div>
              <Input
                id={id}
                value={v.defaultValue}
                aria-label={t('defaultOf', { name: v.name })}
                placeholder={t('defaultPlaceholder')}
                invalid={err !== undefined}
                disabled={disabled}
                maxLength={2000}
                onChange={(e) => patch(i, { defaultValue: e.target.value })}
              />
              {err && (
                <p role="alert" className="mt-1 text-xs text-danger">
                  {err}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
