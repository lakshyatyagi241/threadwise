'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Input, Spinner, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { companiesApi, invalidateCompanies, useCompany, useCompanyPicker } from '../api/companies';
import { errorKind } from '../lib/errors';
import { moveActive, pickerOptions, type CompanyRef, type PickerOption } from '../lib/picker';
import { useDebounced } from '../lib/use-debounced';
import { BuildingIcon, CloseIcon, PlusIcon } from './icons';

/** Whether the company picker belongs on a form for this person: it reads the companies of their record scope. */
export function useCanPickCompany(): boolean {
  return useCan('record.companies.read');
}

export interface CompanyPickerProps {
  /** The company now chosen. Without its `name` the picker reads it from the API. */
  value: CompanyRef | null;
  onChange: (next: { id: string; name: string } | null) => void;
  disabled?: boolean;
  /** The id of the input, for the form's label. */
  id?: string;
  /** Make the chosen company's name a link to its page (a drawer; not in a form, where leaving would lose what was typed). */
  linkToCompany?: boolean;
  invalid?: boolean;
}

/**
 * Links a company on a contact or a deal: search by name (250 ms after typing stops), pick one, or, for someone who may create
 * companies, make it right there from the typed name. The search is the companies picker endpoint, so it lists only the companies
 * the person's record scope reaches; the server checks the same rule again when the form is saved. Render it only where
 * `useCanPickCompany()` is true.
 */
export function CompanyPicker({
  value,
  onChange,
  disabled,
  id,
  linkToCompany,
  invalid,
}: CompanyPickerProps) {
  const t = useTranslations('companies.picker');
  const qc = useQueryClient();
  const canCreate = useCan('record.companies.create');
  const listId = useId();
  const [text, setText] = useState('');
  const term = useDebounced(text.trim(), 250);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);

  const hits = useCompanyPicker(term, open && !value);
  const named = useCompany(value && value.name == null ? value.id : null);

  if (value) {
    const name = value.name ?? named.data?.name;
    const label = name ?? (named.isError ? t('unknown') : t('loading'));
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
        <BuildingIcon className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium" dir="auto">
          {linkToCompany && name ? (
            <Link
              href={`/companies/${value.id}`}
              className="underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {label}
            </Link>
          ) : (
            label
          )}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t('clear')}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <CloseIcon />
          </button>
        )}
      </div>
    );
  }

  const searching = hits.isFetching || text.trim() !== term;
  const options = pickerOptions(hits.data ?? [], text, {
    canCreate,
    settled: !searching && !hits.isError,
  });
  const activeId = active >= 0 && options[active] ? `${listId}-${active}` : undefined;

  function reset() {
    setText('');
    setOpen(false);
    setActive(-1);
  }

  async function choose(option: PickerOption) {
    if (option.kind === 'company') {
      onChange({ id: option.id, name: option.name });
      reset();
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const made = await companiesApi.create({ name: option.name });
      await invalidateCompanies(qc);
      onChange({ id: made.id, name: made.name });
      reset();
    } catch (e) {
      setCreateError(e);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={text}
        disabled={disabled || creating}
        invalid={invalid}
        placeholder={t('search')}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
          setCreateError(null);
        }}
        // A click on a row fires after this blur; the row's mousedown keeps the focus so the click still lands.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (open) {
              e.stopPropagation();
              setOpen(false);
            }
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            setActive((cur) => moveActive(cur, e.key === 'ArrowDown' ? 1 : -1, options.length));
          } else if (e.key === 'Enter' && open && options[active]) {
            e.preventDefault();
            void choose(options[active]);
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('results')}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
        >
          {searching && (
            <li className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
              <Spinner /> {t('searching')}
            </li>
          )}
          {!searching && hits.isError && (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">{t('unavailable')}</li>
          )}
          {!searching && !hits.isError && options.length === 0 && (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">{t('none')}</li>
          )}
          {options.map((o, i) => (
            <li
              key={o.kind === 'company' ? o.id : 'create'}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
            >
              <button
                type="button"
                // mousedown fires before the input's blur closes the list
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void choose(o)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2.5 py-2 text-start text-sm hover:bg-muted',
                  i === active && 'bg-muted',
                  o.kind === 'create' && 'text-brand dark:text-primary',
                )}
              >
                {o.kind === 'company' ? (
                  <>
                    <BuildingIcon className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {o.name}
                    </span>
                    {o.industry && (
                      <span className="shrink-0 text-xs text-muted-foreground" dir="auto">
                        {o.industry}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <PlusIcon />
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {t('create', { name: o.name })}
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <p role="status" className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> {t('creating')}
        </p>
      )}
      {createError !== null && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {errorKind(createError) === 'forbidden' ? t('createForbidden') : t('createFailed')}
        </p>
      )}
    </div>
  );
}
