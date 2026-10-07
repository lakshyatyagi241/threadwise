'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FieldResponse } from '@crm/contracts';
import { Button, Input } from '@crm/ui';
import {
  addableProperties,
  startingChange,
  type BulkPropertyChange,
  type BulkPropertyChanges,
  type BulkPropertyProblem,
} from '../lib/bulk-properties';
import { PropertyInput } from './custom-fields-section';

/**
 * The "Custom properties" part of the bulk update dialog. Every property starts on Keep and is not listed; "Add property"
 * opens a searchable list (it stays usable with dozens of properties) and adds one row at a time. A row holds the property's own
 * typed input (the same one the contact form uses) and two ways out: "Clear" empties the property on every selected contact,
 * "Keep" takes the row away again so that property is left alone.
 */
export function BulkPropertiesSection({
  fields,
  changes,
  problems,
  count,
  idPrefix,
  onChange,
}: {
  /** The workspace's contact properties (any state; the section offers only the editable ones). */
  fields: readonly FieldResponse[];
  changes: BulkPropertyChanges;
  /** Shown under each row; empty until the person tried to apply. */
  problems: Readonly<Record<string, BulkPropertyProblem>>;
  count: number;
  idPrefix: string;
  onChange: (next: BulkPropertyChanges) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.bulkUpdate');
  const tf = useTranslations('contacts-attributes-tags.form');
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const rows = Object.keys(changes)
    .map((k) => byKey.get(k))
    .filter((f): f is FieldResponse => f !== undefined);
  const addable = addableProperties(fields, changes, query);
  const anyEditable = addableProperties(fields, {}, '').length > 0;
  if (!anyEditable && rows.length === 0) return null;

  const set = (key: string, change: BulkPropertyChange) => onChange({ ...changes, [key]: change });
  const remove = (key: string) => {
    const { [key]: _gone, ...rest } = changes;
    onChange(rest);
  };
  const message = (p: BulkPropertyProblem) =>
    p === 'empty' ? t('properties.problemEmpty') : tf(`fieldProblem.${p}`);

  return (
    <fieldset className="space-y-2 border-t border-border pt-4">
      <legend className="text-sm font-medium">{t('properties.title')}</legend>
      <p className="text-xs text-muted-foreground">{t('properties.hint', { count })}</p>

      {rows.length > 0 && (
        <ul className="space-y-2" aria-label={t('properties.changed')}>
          {rows.map((f) => {
            const change = changes[f.key]!;
            const problem = problems[f.key];
            return (
              <li key={f.key} className="rounded-md border border-border p-2.5">
                {change.mode === 'set' ? (
                  <PropertyInput
                    field={f}
                    id={`${idPrefix}-prop-${f.key}`}
                    value={change.value}
                    error={problem ? message(problem) : undefined}
                    onChange={(value) => set(f.key, { mode: 'set', value })}
                  />
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium" dir="auto">
                      {f.label}
                    </p>
                    <p
                      className="text-sm text-muted-foreground"
                      role={problem ? 'alert' : undefined}
                    >
                      {problem ? message(problem) : t('properties.willClear', { count })}
                    </p>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                  {change.mode === 'set' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={f.isRequired}
                      title={f.isRequired ? t('properties.requiredNoClear') : undefined}
                      onClick={() => set(f.key, { mode: 'clear' })}
                    >
                      {t('properties.clear')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => set(f.key, startingChange(f))}
                    >
                      {t('properties.setValue')}
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" onClick={() => remove(f.key)}>
                    {t('properties.keep')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {picking ? (
        <div className="rounded-md border border-border p-2">
          <Input
            id={`${idPrefix}-prop-search`}
            type="search"
            autoFocus
            value={query}
            placeholder={t('properties.search')}
            aria-label={t('properties.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="mt-2 max-h-48 overflow-y-auto" aria-label={t('properties.available')}>
            {addable.map((f) => (
              <li key={f.key}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-muted"
                  onClick={() => {
                    set(f.key, startingChange(f));
                    setPicking(false);
                    setQuery('');
                  }}
                >
                  <span dir="auto">{f.label}</span>
                  <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                    /{f.key}
                  </span>
                </button>
              </li>
            ))}
            {addable.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">
                {t('properties.noMatch')}
              </li>
            )}
          </ul>
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setPicking(false);
                setQuery('');
              }}
            >
              {t('properties.closePicker')}
            </Button>
          </div>
        </div>
      ) : (
        anyEditable && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setPicking(true)}>
            {t('properties.add')}
          </Button>
        )
      )}
    </fieldset>
  );
}
