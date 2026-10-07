'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { FieldDependencyResponse, FieldResponse, FieldSectionResponse } from '@crm/contracts';
import { Badge, Checkbox, Field, Input, Select, Textarea } from '@crm/ui';
import { emptyInput, inputKind, isFieldApplicable, type InputValue } from '../lib/field-values';
import { groupBySection } from '../lib/property-model';

/** The properties the form draws: the workspace's own, active, and not hidden. */
export const isFormField = (f: FieldResponse): boolean => f.isActive && !f.isSystem && !f.isHidden;

/**
 * The workspace's contact properties on the contact form, grouped under their sections. Each one is drawn for its
 * type (text, long text, number, date, dropdown, multi-select, checkbox, link, email, phone); a property with a
 * "show only when" rule appears once the property it waits for has the value.
 */
export function CustomFieldsSection({
  fields,
  sections,
  dependencies,
  values,
  errors,
  idPrefix,
  onChange,
}: {
  fields: readonly FieldResponse[];
  sections: readonly FieldSectionResponse[];
  dependencies: readonly FieldDependencyResponse[];
  values: Readonly<Record<string, InputValue>>;
  /** Message per property key. */
  errors: Readonly<Record<string, string>>;
  idPrefix: string;
  onChange: (key: string, value: InputValue) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.form');
  const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const shown = fields.filter(
    (f) => isFormField(f) && isFieldApplicable(f, dependencies, byId, values),
  );
  const groups = groupBySection(sections, shown).filter((g) => g.fields.length > 0);
  if (groups.length === 0) return null;

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <fieldset key={g.section?.id ?? 'loose'} className="space-y-1.5">
          <legend className="flex w-full items-baseline justify-between gap-2 text-sm font-medium">
            <span dir="auto">{g.section?.name ?? t('customProperties')}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {t('customPropertiesHint')}
            </span>
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {g.fields.map((f) => (
              <PropertyInput
                key={f.id}
                field={f}
                id={`${idPrefix}-prop-${f.key}`}
                value={values[f.key] ?? emptyInput(f)}
                error={errors[f.key]}
                onChange={(v) => onChange(f.key, v)}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/** One property's typed input (text, number, date, dropdown, checkbox ...), shared by the contact form and the bulk update dialog. */
export function PropertyInput({
  field,
  id,
  value,
  error,
  onChange,
}: {
  field: FieldResponse;
  id: string;
  value: InputValue;
  error?: string;
  onChange: (v: InputValue) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.form');
  const kind = inputKind(field);
  const text = Array.isArray(value) ? '' : value;
  const list = Array.isArray(value) ? value : [];
  const description = typeof field.config.description === 'string' ? field.config.description : '';
  const placeholder =
    typeof field.config.defaultValue === 'string' ? field.config.defaultValue : '';
  const readOnly = field.isReadOnly;
  const options = (field.options ?? [])
    .filter((o) => !o.isHidden || text === o.value || list.includes(o.value))
    .sort((a, b) => a.position - b.position);
  const wide = kind === 'textarea' || kind === 'multiselect';

  const label = (
    <>
      <span dir="auto">{field.label}</span>
      {field.isRequired && kind !== 'checkbox' ? ' *' : ''}{' '}
      <span dir="ltr" className="font-mono text-xs text-muted-foreground">
        /{field.key}
      </span>
      {readOnly && <Badge className="ms-1.5 align-middle">{t('readOnlyField')}</Badge>}
    </>
  );

  return (
    <Field
      className={wide ? 'sm:col-span-2' : undefined}
      label={label}
      htmlFor={id}
      hint={description || undefined}
      error={error}
    >
      {kind === 'textarea' ? (
        <Textarea
          id={id}
          rows={3}
          value={text}
          maxLength={4000}
          disabled={readOnly}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : kind === 'select' ? (
        <Select
          id={id}
          value={text}
          disabled={readOnly}
          invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{t('optionPlaceholder')}</option>
          {options.map((o) => (
            <option key={o.id} value={o.value}>
              {o.label}
            </option>
          ))}
          {text !== '' && !options.some((o) => o.value === text) && (
            <option value={text}>{text}</option>
          )}
        </Select>
      ) : kind === 'multiselect' ? (
        <div
          id={id}
          role="group"
          aria-label={field.label}
          className="flex min-h-[2.5rem] flex-wrap gap-1.5 rounded-md border border-border p-2"
        >
          {options.map((o) => {
            const checked = list.includes(o.value);
            return (
              <label
                key={o.id}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:disabled]:cursor-not-allowed"
              >
                <input
                  type="checkbox"
                  className="size-3 accent-[var(--primary)]"
                  checked={checked}
                  disabled={readOnly}
                  onChange={() =>
                    onChange(checked ? list.filter((x) => x !== o.value) : [...list, o.value])
                  }
                />
                {o.label}
              </label>
            );
          })}
          {list
            .filter((v) => !options.some((o) => o.value === v))
            .map((v) => (
              <Badge key={v}>{v}</Badge>
            ))}
        </div>
      ) : kind === 'checkbox' ? (
        <Checkbox
          id={id}
          label={t('yes')}
          checked={text === 'true'}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
      ) : (
        <Input
          id={id}
          type={
            kind === 'number'
              ? 'number'
              : kind === 'date'
                ? 'date'
                : kind === 'datetime'
                  ? 'datetime-local'
                  : kind
          }
          step={kind === 'number' ? (field.fieldType === 'integer' ? 1 : 'any') : undefined}
          dir={kind === 'text' ? 'auto' : 'ltr'}
          value={text}
          maxLength={kind === 'number' || kind === 'date' ? undefined : 1000}
          disabled={readOnly}
          invalid={Boolean(error)}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}
