'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Input, cn } from '@crm/ui';
import { filterOptions } from './timezones';
import { ChevronDownIcon } from './icons';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Lower-cased text the search box matches against. */
  search: string;
}

interface Props {
  id?: string;
  options: readonly ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown when the search matches nothing. */
  emptyLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Accessible name of the input when no visible <label for> points at it. */
  'aria-label'?: string;
  /** Accessible name of the open list. Falls back to `aria-label`. */
  listLabel?: string;
  'aria-describedby'?: string;
  /** Adds a first row that selects the empty value (optional fields). */
  clearLabel?: string;
  className?: string;
}

/**
 * A searchable single-select (WAI-ARIA combobox with a list box): type to
 * narrow, arrows to move, Enter to pick, Escape to close. Used for the timezone,
 * currency and country pickers, which Reference builds with Tom Select.
 */
export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder,
  emptyLabel,
  disabled,
  invalid,
  clearLabel,
  className,
  listLabel,
  ...aria
}: Props) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);
  const rows = useMemo(() => {
    const matches = filterOptions(options, query);
    return clearLabel && !query
      ? [{ value: '', label: clearLabel, search: '' }, ...matches]
      : matches;
  }, [options, query, clearLabel]);

  const optionId = (i: number) => `${autoId}-opt-${i}`;

  const openList = () => {
    if (disabled || open) return;
    const at = rows.findIndex((o) => o.value === value);
    setActive(at === -1 ? 0 : at);
    setOpen(true);
    // Let the list mount, then bring the selected row into view.
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' });
    });
  };

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const pick = (row: ComboboxOption | undefined) => {
    if (!row) return;
    onChange(row.value);
    close();
  };

  const move = (to: number) => {
    const next = Math.min(Math.max(to, 0), Math.max(rows.length - 1, 0));
    setActive(next);
    requestAnimationFrame(() => {
      document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openList();
        else move(active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openList();
        else move(active - 1);
        break;
      case 'Home':
        if (open) {
          e.preventDefault();
          move(0);
        }
        break;
      case 'End':
        if (open) {
          e.preventDefault();
          move(rows.length - 1);
        }
        break;
      case 'Enter':
        if (open) {
          e.preventDefault();
          pick(rows[active]);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        break;
      case 'Tab':
        if (open) close();
        break;
    }
  };

  return (
    <div className={cn('relative', className)}>
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows.length > 0 ? optionId(active) : undefined}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        dir="auto"
        disabled={disabled}
        invalid={invalid}
        placeholder={placeholder}
        className="pe-9"
        value={open ? query : (selected?.label ?? '')}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          if (!open) setOpen(true);
        }}
        onFocus={(e) => {
          openList();
          e.currentTarget.select();
        }}
        onClick={openList}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      <ChevronDownIcon
        className={cn(
          'pointer-events-none absolute end-3 top-3 size-4 text-muted-foreground transition-transform',
          open && 'rotate-180',
        )}
      />
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={listLabel ?? aria['aria-label']}
          // Keep focus in the input while the list (or its scrollbar) is pressed.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-background py-1 text-sm shadow-lg"
        >
          {rows.length === 0 ? (
            <li role="presentation" className="px-3 py-2 text-muted-foreground">
              {emptyLabel}
            </li>
          ) : (
            rows.map((row, i) => (
              <li
                key={row.value || '__none'}
                id={optionId(i)}
                role="option"
                aria-selected={row.value === value}
                // mousedown, not click: the input's blur would otherwise close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(row);
                }}
                onMouseMove={() => setActive(i)}
                className={cn(
                  'cursor-pointer px-3 py-2',
                  i === active && 'bg-muted',
                  row.value === value && 'font-medium text-primary',
                  !row.value && 'text-muted-foreground',
                )}
              >
                <bdi>{row.label}</bdi>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
