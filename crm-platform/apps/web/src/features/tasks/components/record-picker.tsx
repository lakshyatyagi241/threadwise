'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input, Spinner } from '@crm/ui';
import { rememberMockRef } from '../api/http';
import { contactLabel, type RecordRef } from '../api/schemas';
import { tasksApi } from '../api/service';
import { BuildingIcon, CloseIcon, ContactIcon, DealIcon } from './icons';

/**
 * Links a contact, a deal or a company: search by name (250 ms after typing stops), pick one, or clear the link. Used by the task
 * form and the drawer, and (compact) by the toolbar's "Linked to" filter.
 */
export function RecordPicker({
  kind,
  value,
  onChange,
  disabled,
  id,
  compact,
}: {
  kind: 'contact' | 'deal' | 'company';
  value: RecordRef | null;
  onChange: (next: RecordRef | null) => void;
  disabled?: boolean;
  id?: string;
  compact?: boolean;
}) {
  const t = useTranslations('tasks.picker');
  const listId = useId();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const Icon = kind === 'contact' ? ContactIcon : kind === 'company' ? BuildingIcon : DealIcon;
  const searchKey =
    kind === 'contact' ? 'searchContact' : kind === 'company' ? 'searchCompany' : 'searchDeal';

  useEffect(() => {
    const h = window.setTimeout(() => setTerm(text), 250);
    return () => window.clearTimeout(h);
  }, [text]);

  const hits = useQuery({
    queryKey: ['tasks', 'search', kind, term],
    queryFn: async ({ signal }): Promise<RecordRef[]> =>
      kind === 'contact'
        ? (await tasksApi.searchContacts(term, signal)).map((c) => ({
            id: c.id,
            label: contactLabel(c),
            hint: c.phone,
          }))
        : kind === 'company'
          ? (await tasksApi.searchCompanies(term, signal)).map((c) => ({
              id: c.id,
              label: c.name,
              hint: c.industry,
            }))
          : (await tasksApi.searchDeals(term, signal)).map((d) => ({ id: d.id, label: d.title })),
    enabled: open && !value,
    retry: false,
    staleTime: 30_000,
  });

  if (value) {
    return (
      <div
        className={
          compact
            ? 'inline-flex h-10 max-w-56 items-center gap-2 rounded-md border border-border bg-muted/40 ps-2.5 pe-1 text-sm'
            : 'flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm'
        }
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{value.label}</span>
          {!compact && value.hint && (
            <span className="block truncate text-xs text-muted-foreground">{value.hint}</span>
          )}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t('unlink')}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <CloseIcon className="size-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={text}
        disabled={disabled}
        placeholder={t(searchKey)}
        aria-label={t(searchKey)}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        className={compact ? 'w-52' : undefined}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('results')}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 min-w-56 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
        >
          {hits.isFetching && (
            <li className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
              <Spinner /> {t('searching')}
            </li>
          )}
          {!hits.isFetching && hits.isError && (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">{t('unavailable')}</li>
          )}
          {!hits.isFetching && !hits.isError && (hits.data?.length ?? 0) === 0 && (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">{t('none')}</li>
          )}
          {!hits.isFetching &&
            (hits.data ?? []).map((r) => (
              <li key={r.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  // mousedown fires before the input's blur closes the list
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    rememberMockRef(kind, r.id, r.label);
                    onChange(r);
                    setText('');
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-start text-sm hover:bg-muted"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  {r.hint && (
                    <span className="shrink-0 text-xs text-muted-foreground">{r.hint}</span>
                  )}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
