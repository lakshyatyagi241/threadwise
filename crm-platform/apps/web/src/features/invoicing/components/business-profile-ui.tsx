'use client';

import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import type { InvoiceProfile } from '@crm/contracts';
import { Button, Input, cn } from '@crm/ui';
import type { ProfileForm, Row } from '../lib/profile-form';
import { PlusIcon, TrashIcon } from './icons';

/** What every section of the Business profile form receives: the values, how to change them, the messages and the lock. */
export interface EditorCtx {
  form: ProfileForm;
  set: <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => void;
  /** The message for a field path (a client check or the server's answer), or undefined. */
  err: (path: string) => string | undefined;
  /** Read-only: the person may read the profile but not change it. */
  readOnly: boolean;
  profile: InvoiceProfile;
}

/** A titled card of the form. The id is the anchor of the section menu. */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 rounded-xl border border-border bg-background">
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </header>
      <div className="space-y-5 p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** A small heading inside a section. */
export function SubHeading({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{children}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Label and value rows (the statutory extras, the bank details). Blank rows are ignored on save; a half-filled row is flagged. */
export function RowsEditor({
  rows,
  onChange,
  max,
  errPrefix,
  err,
  disabled,
  suggestions,
  labelMax,
  valueMax,
  labelPlaceholder,
  valuePlaceholder,
}: {
  rows: readonly Row[];
  onChange: (rows: Row[]) => void;
  max: number;
  errPrefix: string;
  err: (path: string) => string | undefined;
  disabled?: boolean;
  suggestions?: readonly string[];
  labelMax: number;
  valueMax: number;
  labelPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const t = useTranslations('invoicing.settings.rows');
  const uid = useId();
  const used = new Set(rows.map((r) => r.label.trim().toLowerCase()));
  const free = (suggestions ?? []).filter((s) => !used.has(s.toLowerCase()));
  const update = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function addSuggestion(label: string) {
    const blank = rows.findIndex((r) => !r.label.trim() && !r.value.trim());
    if (blank >= 0) update(blank, { label });
    else if (rows.length < max) onChange([...rows, { label, value: '' }]);
  }

  const top = err(errPrefix);
  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      <ul className="space-y-3">
        {rows.map((r, i) => {
          const le = err(`${errPrefix}.${i}.label`);
          const ve = err(`${errPrefix}.${i}.value`);
          return (
            <li key={i} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-start sm:border-0 sm:p-0">
              <div className="sm:w-56 sm:shrink-0">
                <Input
                  id={`${uid}-l${i}`}
                  value={r.label}
                  maxLength={labelMax + 20}
                  disabled={disabled}
                  invalid={!!le}
                  placeholder={labelPlaceholder ?? t('label')}
                  aria-label={t('labelOf', { n: i + 1 })}
                  dir="auto"
                  onChange={(e) => update(i, { label: e.target.value })}
                />
                {le && (
                  <p role="alert" className="mt-1 text-xs text-danger">
                    {le}
                  </p>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  id={`${uid}-v${i}`}
                  value={r.value}
                  maxLength={valueMax + 40}
                  disabled={disabled}
                  invalid={!!ve}
                  placeholder={valuePlaceholder ?? t('value')}
                  aria-label={t('valueOf', { n: i + 1 })}
                  dir="auto"
                  onChange={(e) => update(i, { value: e.target.value })}
                />
                {ve && (
                  <p role="alert" className="mt-1 text-xs text-danger">
                    {ve}
                  </p>
                )}
              </div>
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 w-full shrink-0 text-danger sm:w-10 sm:px-0"
                  aria-label={t('remove', { n: i + 1 })}
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                >
                  <TrashIcon />
                  <span className="sm:sr-only">{t('removeShort')}</span>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {top && (
        <p role="alert" className="text-xs text-danger">
          {top}
        </p>
      )}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" disabled={rows.length >= max} onClick={() => onChange([...rows, { label: '', value: '' }])}>
            <PlusIcon /> {t('add')}
          </Button>
          <span className={cn('text-xs tabular-nums', rows.length >= max ? 'text-warning' : 'text-muted-foreground')}>
            {t('count', { count: rows.length, max })}
          </span>
        </div>
      )}
      {!disabled && free.length > 0 && rows.length < max && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('suggestions')}</span>
          {free.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addSuggestion(s)}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-muted px-3 text-xs font-medium hover:bg-background focus-visible:ring-2 focus-visible:ring-primary"
            >
              <PlusIcon className="size-3" /> <span dir="auto">{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
