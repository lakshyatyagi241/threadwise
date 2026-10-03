'use client';

import 'flag-icons/css/flag-icons.min.css';
import type { CountryCode } from 'libphonenumber-js';
import { getCountryCallingCode } from 'libphonenumber-js';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { filterOptions } from '../shared/timezones';
import {
  countryFromInternational,
  evaluatePhone,
  flagClass,
  formatNational,
  listCountries,
  type CountryOption,
  type PhoneState,
} from './phone';
import { cn } from './ui';

export interface PhoneValue {
  raw: string;
  iso: CountryCode;
  state: PhoneState;
}

/**
 * International phone field: one box holding a country button (flag image and dial code) and the national
 * number. The button opens a searchable, alphabetical list that opens scrolled to the chosen country (the
 * reference product's newer picker no longer shows a block of preferred countries, so neither does this).
 * Typing or pasting "+44 ..." switches the country. Produces E.164 through libphonenumber-js (WD-AUTH-005).
 *
 * The list is a popover, so it floats above the page (and the form's scroll area) from where it sits in the
 * markup, which keeps the guest palette and type that are inherited from the layout.
 */
export function PhoneInput({
  id,
  name,
  value,
  onChange,
  invalid,
  describedBy,
  placeholder,
}: {
  id: string;
  name: string;
  value: PhoneValue;
  onChange: (next: PhoneValue) => void;
  invalid: boolean;
  describedBy?: string;
  placeholder?: string;
}) {
  const t = useTranslations('auth-registration-security.guest.signup');
  const locale = useLocale();
  const dial = getCountryCallingCode(value.iso);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  function update(raw: string, iso: CountryCode) {
    onChange({ raw, iso, state: evaluatePhone(raw, iso) });
  }

  // Names come from the browser's ICU data, so the list is built when the popover opens, not on the server.
  const countries = useMemo(() => (open ? listCountries(locale) : []), [open, locale]);
  // The whole alphabetical list, or the countries matching the search box.
  const rows = useMemo<CountryOption[]>(
    () => (query.trim() ? filterOptions(countries, query.trim()) : countries),
    [query, countries],
  );

  function place() {
    const el = pop.current;
    const anchor = box.current;
    if (!el || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const height = Math.min(320, el.scrollHeight || 320);
    const top = below >= height + 8 || below >= rect.top ? rect.bottom + 4 : rect.top - height - 4;
    el.style.left = `${rect.left}px`;
    el.style.top = `${Math.max(8, top)}px`;
    el.style.width = `${rect.width}px`;
  }

  function openList() {
    const el = pop.current;
    if (!el || open) return;
    setQuery('');
    place();
    el.showPopover();
    requestAnimationFrame(() => {
      place();
      search.current?.focus();
      // Open on the chosen country: the list is scrolled so it is in view and marked.
      const at = listCountries(locale).findIndex((c) => c.iso === value.iso);
      setActive(at === -1 ? 0 : at);
      // One more frame: the rows are drawn once the popover reports that it is open.
      requestAnimationFrame(() =>
        document.getElementById(`${listId}-${at}`)?.scrollIntoView({ block: 'center' }),
      );
    });
  }

  // The list is positioned from the box's place on screen, so it closes when the page moves under it.
  useEffect(() => {
    if (!open) return;
    const close = () => pop.current?.hidePopover();
    // Scrolling the list itself must not close it.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && pop.current?.contains(e.target)) return;
      close();
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  function pick(country: CountryOption | undefined) {
    if (!country) return;
    update(value.raw, country.iso);
    pop.current?.hidePopover();
    field.current?.focus();
  }

  function move(to: number) {
    const next = Math.min(Math.max(to, 0), Math.max(rows.length - 1, 0));
    setActive(next);
    requestAnimationFrame(() => {
      document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' });
    });
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(active - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(rows.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(rows[active]);
    }
  }

  return (
    <div className="relative">
      <div
        ref={box}
        // A phone number reads left to right whatever the page language: flag, dial code, digits.
        dir="ltr"
        className={cn(
          'flex w-full items-stretch rounded-lg border bg-background text-[13px] text-foreground',
          'focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10',
          invalid ? 'border-danger' : 'border-border',
        )}
      >
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={t('countryButton', { dial })}
          onClick={openList}
          className="flex shrink-0 items-center gap-1.5 rounded-s-lg border-e border-border px-3 outline-none hover:bg-muted focus-visible:bg-muted"
        >
          <span className={cn(flagClass(value.iso), 'shrink-0 text-base')} aria-hidden="true" />
          <span dir="ltr" className="text-(--auth-ink-600)">
            +{dial}
          </span>
          <svg
            viewBox="0 0 12 12"
            className="size-3 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M2 4l4 4 4-4" />
          </svg>
        </button>
        <input
          ref={field}
          id={id}
          name={name}
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel-national"
          value={value.raw}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d+()\-\s.]/g, '');
            const detected = countryFromInternational(raw);
            // Switch the picker only when the typed +code belongs to a different calling code.
            const iso = detected && getCountryCallingCode(detected) !== dial ? detected : value.iso;
            update(raw, iso);
          }}
          onBlur={() => {
            const formatted = formatNational(value.raw, value.iso);
            if (formatted !== value.raw) update(formatted, value.iso);
          }}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-start outline-none placeholder:text-(--auth-ink-400)"
        />
      </div>

      <div
        ref={pop}
        popover="auto"
        onToggle={(e) => {
          const nowOpen = (e.nativeEvent as ToggleEvent).newState === 'open';
          setOpen(nowOpen);
          if (!nowOpen) setQuery('');
        }}
        className="fixed m-0 max-h-80 overflow-hidden rounded-xl border border-border bg-background p-0 text-foreground shadow-(--auth-shadow-pop) [inset:auto]"
      >
        <div className="border-b border-border p-2">
          <input
            ref={search}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows.length > 0 ? `${listId}-${active}` : undefined}
            aria-label={t('countrySearch')}
            placeholder={t('countrySearch')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onSearchKey}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-primary"
          />
        </div>
        <ul
          id={listId}
          role="listbox"
          aria-label={t('country')}
          className="max-h-60 overflow-y-auto py-1 text-[13px]"
        >
          {rows.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-muted-foreground">
              {t('countryEmpty')}
            </li>
          )}
          {rows.map((country, at) => (
            <li
              key={country.iso}
              id={`${listId}-${at}`}
              role="option"
              aria-selected={country.iso === value.iso}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(country)}
              onMouseMove={() => setActive(at)}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 px-3 py-1.5',
                at === active && 'bg-muted',
              )}
            >
              <span
                className={cn(flagClass(country.iso), 'shrink-0 text-base')}
                aria-hidden="true"
              />
              <bdi className="min-w-0 flex-1 truncate">
                {country.name}{' '}
                <span dir="ltr" className="text-muted-foreground">
                  (+{country.dial})
                </span>
              </bdi>
              {country.iso === value.iso && (
                <svg
                  viewBox="0 0 16 16"
                  className="size-4 shrink-0 text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <circle cx="8" cy="8" r="7" fill="currentColor" stroke="none" opacity="0.7" />
                  <path d="M5 8.2l2 2 4-4.2" stroke="var(--background)" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
