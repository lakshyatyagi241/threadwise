'use client';

import { useTranslations } from 'next-intl';
import { Button, Field, Input, Select } from '@crm/ui';
import { useContactProperties } from '../api';
import {
  ATTRIBUTION_FIELDS,
  MAPPING_FIELDS,
  MAX_CUSTOM_FIELDS,
  PATHS_LIST_ID,
  PATH_MAX,
  newRow,
  rowPath,
  type AttributionField,
  type CustomFieldRow,
  type MappingField,
  type PathTarget,
} from '../lib/draft';
import { useFieldError, type FieldsProps } from './source-fields';

/** The payload paths the preview found, offered by the browser as it autocompletes any mapping input. */
export function PathsDatalist({ paths }: { paths: readonly string[] }) {
  return (
    <datalist id={PATHS_LIST_ID}>
      {paths.slice(0, 300).map((p) => (
        <option key={p} value={p} />
      ))}
    </datalist>
  );
}

/**
 * The mapping of a source: which place in the sender's payload fills each contact field, each custom property and each
 * attribution value. A path is a key (`phone_number`) or a dotted path (`lead.contact.phone`, `answers[0].value`); an empty box
 * means "look under the common names". The input the person focused last is the one a clicked path chip fills.
 */
export function MappingFields({
  draft,
  set,
  problems,
  server,
  disabled,
  onFocusTarget,
}: FieldsProps & { onFocusTarget: (target: PathTarget) => void }) {
  const t = useTranslations('lead-sources.mapping');
  const error = useFieldError(problems, server);
  const properties = useContactProperties();

  const setField = (field: MappingField, value: string) =>
    set((d) => ({
      ...d,
      mapping: { ...d.mapping, fields: { ...d.mapping.fields, [field]: value } },
    }));
  const setAttribution = (field: AttributionField, value: string) =>
    set((d) => ({
      ...d,
      mapping: { ...d.mapping, attribution: { ...d.mapping.attribution, [field]: value } },
    }));
  const setRows = (fn: (rows: CustomFieldRow[]) => CustomFieldRow[]) =>
    set((d) => ({
      ...d,
      mapping: { ...d.mapping, customFields: fn(d.mapping.customFields) },
    }));

  const pathInput = (
    id: string,
    value: string,
    onChange: (v: string) => void,
    target: PathTarget,
    invalid: boolean,
    placeholder?: string,
  ) => (
    <Input
      id={id}
      dir="ltr"
      list={PATHS_LIST_ID}
      value={value}
      disabled={disabled}
      invalid={invalid}
      placeholder={placeholder}
      maxLength={PATH_MAX + 20}
      autoComplete="off"
      onFocus={() => onFocusTarget(target)}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <div className="space-y-6">
      <section aria-labelledby="ls-map-contact" className="space-y-3">
        <h3 id="ls-map-contact" className="text-sm font-semibold">
          {t('contact')}
        </h3>
        <p className="text-xs text-muted-foreground">{t('contactHelp')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {MAPPING_FIELDS.map((f) => (
            <Field
              key={f}
              label={t(`fields.${f}`)}
              htmlFor={`ls-map-${f}`}
              hint={t(`defaults.${f}`)}
              error={error(`mapping.${f}`)}
            >
              {pathInput(
                `ls-map-${f}`,
                draft.mapping.fields[f],
                (v) => setField(f, v),
                { kind: 'field', field: f },
                Boolean(error(`mapping.${f}`)),
              )}
            </Field>
          ))}
        </div>
      </section>

      <section aria-labelledby="ls-map-custom" className="space-y-3">
        <h3 id="ls-map-custom" className="text-sm font-semibold">
          {t('custom')}
        </h3>
        <p className="text-xs text-muted-foreground">{t('customHelp')}</p>
        {properties.isError && <p className="text-xs text-warning">{t('propertiesFailed')}</p>}
        {error('mapping.customFields') && (
          <p role="alert" className="text-xs text-danger">
            {error('mapping.customFields')}
          </p>
        )}
        <ul className="space-y-3">
          {draft.mapping.customFields.map((r, i) => {
            const keyError = error(rowPath(r.id, 'key')) ?? error(`mapping.customFields.${r.key}`);
            const pathError = error(rowPath(r.id, 'path'));
            const options = properties.data ?? [];
            return (
              <li
                key={r.id}
                data-testid="custom-field-row"
                className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
              >
                <Field label={t('property')} htmlFor={`ls-cf-key-${r.id}`} error={keyError}>
                  {properties.isError ? (
                    <Input
                      id={`ls-cf-key-${r.id}`}
                      dir="ltr"
                      value={r.key}
                      disabled={disabled}
                      invalid={Boolean(keyError)}
                      placeholder="budget"
                      onChange={(e) =>
                        setRows((rows) =>
                          rows.map((x) => (x.id === r.id ? { ...x, key: e.target.value } : x)),
                        )
                      }
                    />
                  ) : (
                    <Select
                      id={`ls-cf-key-${r.id}`}
                      value={r.key}
                      disabled={disabled || properties.isPending}
                      invalid={Boolean(keyError)}
                      onChange={(e) =>
                        setRows((rows) =>
                          rows.map((x) => (x.id === r.id ? { ...x, key: e.target.value } : x)),
                        )
                      }
                    >
                      <option value="">{t('propertyChoose')}</option>
                      {options.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label} ({o.key})
                        </option>
                      ))}
                      {r.key !== '' && !options.some((o) => o.key === r.key) && (
                        <option value={r.key}>{r.key}</option>
                      )}
                    </Select>
                  )}
                </Field>
                <Field label={t('path')} htmlFor={`ls-cf-path-${r.id}`} error={pathError}>
                  {pathInput(
                    `ls-cf-path-${r.id}`,
                    r.path,
                    (v) =>
                      setRows((rows) => rows.map((x) => (x.id === r.id ? { ...x, path: v } : x))),
                    { kind: 'custom', rowId: r.id },
                    Boolean(pathError),
                    'lead.budget',
                  )}
                </Field>
                {!disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="sm:mt-6"
                    aria-label={t('removeRow', { number: i + 1 })}
                    onClick={() => setRows((rows) => rows.filter((x) => x.id !== r.id))}
                  >
                    {t('remove')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {!disabled && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={draft.mapping.customFields.length >= MAX_CUSTOM_FIELDS}
            onClick={() => setRows((rows) => [...rows, newRow()])}
          >
            {t('addRow')}
          </Button>
        )}
      </section>

      <section aria-labelledby="ls-map-attr" className="space-y-3">
        <h3 id="ls-map-attr" className="text-sm font-semibold">
          {t('attribution')}
        </h3>
        <p className="text-xs text-muted-foreground">{t('attributionHelp')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {ATTRIBUTION_FIELDS.map((f) => (
            <Field
              key={f}
              label={t(`attributionFields.${f}`)}
              htmlFor={`ls-attr-${f}`}
              hint={t(`attributionDefaults.${f}`)}
              error={error(`mapping.attribution.${f}`)}
            >
              {pathInput(
                `ls-attr-${f}`,
                draft.mapping.attribution[f],
                (v) => setAttribution(f, v),
                { kind: 'attribution', field: f },
                Boolean(error(`mapping.attribution.${f}`)),
              )}
            </Field>
          ))}
        </div>
      </section>
    </div>
  );
}
