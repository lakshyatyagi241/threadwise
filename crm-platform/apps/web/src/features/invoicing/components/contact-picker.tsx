'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input, Spinner } from '@crm/ui';
import { contactLabel, invoicingApi, type ContactHit } from '../api/service';
import { CloseIcon, ContactIcon } from './icons';

export interface PickedContact {
  id: string;
  label: string;
  email: string | null;
  phone: string | null;
}

/**
 * Picks a contact: search by name (250 ms after typing stops), pick one, or clear it. Used by the builder (the buyer) and,
 * compact, by the list's "Contact" filter.
 */
export function ContactPicker({
  value,
  onChange,
  disabled,
  id,
  compact,
  invalid,
}: {
  value: { id: string; label: string } | null;
  onChange: (next: PickedContact | null) => void;
  disabled?: boolean;
  id?: string;
  compact?: boolean;
  invalid?: boolean;
}) {
  const t = useTranslations('invoicing.picker');
  const listId = useId();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const h = window.setTimeout(() => setTerm(text), 250);
    return () => window.clearTimeout(h);
  }, [text]);

  const hits = useQuery({
    queryKey: ['invoicing', 'search', 'contact', term],
    queryFn: ({ signal }) => invoicingApi.searchContacts(term, signal),
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
            : 'flex min-h-10 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm'
        }
      >
        <ContactIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium" dir="auto">
          {value.label}
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

  const pick = (c: ContactHit) => {
    const label = contactLabel(c);
    onChange({ id: c.id, label, email: c.email ?? null, phone: c.phone });
    setText('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        value={text}
        disabled={disabled}
        invalid={invalid}
        placeholder={t('searchContact')}
        aria-label={t('searchContact')}
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
            (hits.data ?? []).map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  // mousedown fires before the input's blur closes the list
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-start text-sm hover:bg-muted"
                >
                  <ContactIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {contactLabel(c)}
                  </span>
                  {c.phone && (
                    <span dir="ltr" className="shrink-0 text-xs text-muted-foreground">
                      {c.phone}
                    </span>
                  )}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
