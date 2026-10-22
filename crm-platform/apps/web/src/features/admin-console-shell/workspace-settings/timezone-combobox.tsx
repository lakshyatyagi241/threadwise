'use client';

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { filterTimeZones } from './logic';

const NS = 'admin-console-shell.workspaceSettings.general';

/**
 * The workspace time zone picker with a search box: typing narrows the list, Arrow keys move through the matches, Enter picks one
 * and Escape drops the search. The box keeps the focus, as in a combobox; leaving it without a pick keeps the zone already chosen.
 */
export function TimezoneCombobox({
  id,
  value,
  zones,
  disabled,
  onChange,
}: {
  id: string;
  /** The chosen zone. */
  value: string;
  /** Every zone on offer, in the order shown. */
  zones: readonly string[];
  disabled?: boolean;
  onChange: (zone: string) => void;
}) {
  const t = useTranslations(NS);
  const listId = useId();
  const [open, setOpen] = useState(false);
  // What is typed while the list is open; null while the box shows the chosen zone.
  const [search, setSearch] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => filterTimeZones(zones, search ?? ''), [zones, search]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open, listId]);

  const openList = () => {
    setOpen(true);
    setActive(Math.max(0, zones.indexOf(value)));
  };
  const close = () => {
    setSearch(null);
    setOpen(false);
  };
  const pick = (zone: string) => {
    onChange(zone);
    close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openList();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(matches.length - 1, i + step)));
      return;
    }
    if (!open) return;
    if (e.key === 'Enter') {
      // A pick, not a form submit.
      e.preventDefault();
      const zone = matches[active];
      if (zone) pick(zone);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        disabled={disabled}
        placeholder={t('timezoneSearch')}
        value={search ?? value}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          setSearch(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onClick={() => {
          if (!open) openList();
        }}
        onFocus={(e) => e.target.select()}
        onBlur={close}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-background text-sm shadow-md">
          <ul id={listId} role="listbox" className="max-h-64 overflow-auto py-1">
            {matches.map((zone, i) => (
              <li
                key={zone}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={zone === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(zone)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'cursor-pointer px-3 py-1.5',
                  i === active && 'bg-primary text-primary-foreground',
                  zone === value && 'font-medium',
                )}
              >
                {zone}
              </li>
            ))}
          </ul>
          {matches.length === 0 && (
            <p className="px-3 py-2 text-muted-foreground">{t('timezoneNoMatch')}</p>
          )}
        </div>
      )}
    </div>
  );
}
