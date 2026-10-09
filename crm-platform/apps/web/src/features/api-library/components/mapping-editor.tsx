'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  API_LIBRARY_MAX_MAPPINGS,
  API_LIBRARY_MAX_RESPONSE_VARIABLES,
  API_LIBRARY_PATH_RE,
  type ApiLibraryContactProperty,
} from '@crm/contracts';
import { Button, Input, Select } from '@crm/ui';
import { emptyMapping, type FormErrors, type MappingRow } from '../lib/form-model';
import { leavesOf } from '../lib/paths';

/** "Pick a path from the last test response": a list of every value in the answer, so no path has to be typed from memory. */
function PathPicker({
  json,
  taken,
  onPick,
  label,
  disabled,
}: {
  json: unknown;
  taken: readonly string[];
  onPick: (path: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const t = useTranslations('api-library.form.mapping');
  const leaves = useMemo(() => (json == null ? [] : leavesOf(json)), [json]);
  const options = leaves.filter((l) => API_LIBRARY_PATH_RE.test(l.path) && !taken.includes(l.path));
  if (json == null) return <p className="text-xs text-muted-foreground">{t('runTestFirst')}</p>;
  return (
    <Select
      aria-label={label}
      value=""
      disabled={disabled || options.length === 0}
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
      }}
    >
      <option value="">{options.length === 0 ? t('noPaths') : label}</option>
      {options.map((l) => (
        <option key={l.path} value={l.path}>
          {l.path} = {l.value.length > 40 ? `${l.value.slice(0, 39)}…` : l.value}
        </option>
      ))}
    </Select>
  );
}

/** Response -> contact: which field of the answer is written into which contact property, and what to write when it is missing. */
export function MappingEditor({
  rows,
  onChange,
  properties,
  propertiesState,
  lastJson,
  errors,
  disabled,
}: {
  rows: MappingRow[];
  onChange: (rows: MappingRow[]) => void;
  properties: ApiLibraryContactProperty[];
  propertiesState: 'loading' | 'error' | 'ready';
  lastJson: unknown;
  errors: FormErrors;
  disabled?: boolean;
}) {
  const t = useTranslations('api-library.form.mapping');
  const patch = (i: number, p: Partial<MappingRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const known = new Set(properties.map((p) => p.key));

  return (
    <div className="space-y-3">
      {propertiesState === 'error' && (
        <p role="alert" className="text-xs text-danger">
          {t('propertiesFailed')}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-1 pb-1 text-start font-medium">
                  {t('path')}
                </th>
                <th scope="col" className="px-1 pb-1 text-start font-medium">
                  {t('property')}
                </th>
                <th scope="col" className="px-1 pb-1 text-start font-medium">
                  {t('default')}
                </th>
                <th scope="col" className="px-1 pb-1">
                  <span className="sr-only">{t('remove')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const err = errors.fields[`mapping:${r.id}`];
                return (
                  <tr key={r.id} className="align-top">
                    <td className="p-1">
                      <Input
                        value={r.path}
                        dir="ltr"
                        aria-label={t('pathN', { n: i + 1 })}
                        placeholder="data.items[0].name"
                        invalid={err !== undefined}
                        disabled={disabled}
                        onChange={(e) => patch(i, { path: e.target.value })}
                      />
                      {err && (
                        <p role="alert" className="mt-1 text-xs text-danger">
                          {err}
                        </p>
                      )}
                    </td>
                    <td className="p-1">
                      <Select
                        value={r.contactProperty}
                        aria-label={t('propertyN', { n: i + 1 })}
                        disabled={disabled}
                        onChange={(e) => patch(i, { contactProperty: e.target.value })}
                      >
                        <option value="">
                          {propertiesState === 'loading' ? t('loading') : t('choose')}
                        </option>
                        {r.contactProperty !== '' && !known.has(r.contactProperty) && (
                          <option value={r.contactProperty}>{r.contactProperty}</option>
                        )}
                        {properties.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="p-1">
                      <Input
                        value={r.defaultValue}
                        aria-label={t('defaultN', { n: i + 1 })}
                        placeholder={t('defaultPlaceholder')}
                        maxLength={2000}
                        disabled={disabled}
                        onChange={(e) => patch(i, { defaultValue: e.target.value })}
                      />
                    </td>
                    <td className="p-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        aria-label={t('removeN', { n: i + 1 })}
                        onClick={() => onChange(rows.filter((_, j) => j !== i))}
                      >
                        ×
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <PathPicker
          json={lastJson}
          taken={rows.map((r) => r.path)}
          label={t('pick')}
          disabled={disabled || rows.length >= API_LIBRARY_MAX_MAPPINGS}
          onPick={(path) => onChange([...rows, emptyMapping(path)])}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || rows.length >= API_LIBRARY_MAX_MAPPINGS}
          onClick={() => onChange([...rows, emptyMapping()])}
        >
          {t('add')}
        </Button>
      </div>
    </div>
  );
}

/** Response paths a flow reads as `{{ApiName.path}}` (the old "Use in bot"). */
export function ResponseVariablesEditor({
  paths,
  onChange,
  apiName,
  lastJson,
  disabled,
}: {
  paths: string[];
  onChange: (paths: string[]) => void;
  apiName: string;
  lastJson: unknown;
  disabled?: boolean;
}) {
  const t = useTranslations('api-library.form.responseVars');
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const valid = trimmed !== '' && API_LIBRARY_PATH_RE.test(trimmed) && !paths.includes(trimmed);
  const add = (p: string) => {
    if (!paths.includes(p)) onChange([...paths, p]);
  };
  return (
    <div className="space-y-3">
      {paths.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {paths.map((p) => (
            <li
              key={p}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 ps-2.5 pe-1 font-mono text-xs text-primary"
              dir="ltr"
            >
              {`{{${apiName || 'Name'}.${p}}}`}
              <button
                type="button"
                disabled={disabled}
                aria-label={t('remove', { path: p })}
                onClick={() => onChange(paths.filter((x) => x !== p))}
                className="flex size-5 items-center justify-center rounded-full hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input
          value={draft}
          dir="ltr"
          aria-label={t('typePath')}
          placeholder="data.items[].name"
          disabled={disabled || paths.length >= API_LIBRARY_MAX_RESPONSE_VARIABLES}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) {
              e.preventDefault();
              add(trimmed);
              setDraft('');
            }
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || !valid}
          onClick={() => {
            add(trimmed);
            setDraft('');
          }}
        >
          {t('add')}
        </Button>
      </div>
      {lastJson != null && (
        <PathPicker
          json={lastJson}
          taken={paths}
          label={t('pick')}
          disabled={disabled}
          onPick={add}
        />
      )}
    </div>
  );
}
