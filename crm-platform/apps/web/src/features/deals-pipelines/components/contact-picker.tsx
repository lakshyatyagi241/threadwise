'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input, Spinner } from '@crm/ui';
import { dealsApi } from '../api/service';
import type { ContactHit, ContactRef } from '../api/schemas';
import { Avatar } from './parts';
import { CloseIcon } from './icons';

const label = (c: ContactHit) =>
  c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone || '';

/** Links a contact: search by name or phone (250 ms after typing stops), pick one, or clear the link. */
export function ContactPicker({
  value,
  onChange,
  disabled,
  id,
}: {
  value: ContactRef | null;
  onChange: (next: ContactRef | null) => void;
  disabled?: boolean;
  id?: string;
}) {
  const t = useTranslations('deals-pipelines.contact');
  const listId = useId();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const h = window.setTimeout(() => setTerm(text), 250);
    return () => window.clearTimeout(h);
  }, [text]);

  const hits = useQuery({
    queryKey: ['deals', 'contact-search', term],
    queryFn: ({ signal }) => dealsApi.searchContacts(term, signal),
    enabled: open && !value,
    retry: false,
    staleTime: 30_000,
  });

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
        <Avatar name={value.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{value.name}</span>
          {value.phone && <span className="block truncate text-xs text-muted-foreground">{value.phone}</span>}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t('unlink')}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <CloseIcon />
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
        placeholder={t('search')}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('results')}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
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
            (hits.data ?? []).map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  // mousedown fires before the input's blur closes the list
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange({ id: c.id, name: label(c), phone: c.phone });
                    setText('');
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-start text-sm hover:bg-muted"
                >
                  <Avatar name={label(c)} />
                  <span className="min-w-0 flex-1 truncate">{label(c)}</span>
                  {c.phone && <span className="shrink-0 text-xs text-muted-foreground">{c.phone}</span>}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
