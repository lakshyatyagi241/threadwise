'use client';

import { useId, useMemo, useState } from 'react';
import { Input, Select } from '@crm/ui';

export interface CountryOption {
  code: string;
  name: string;
}

/** Countries whose name or code contains the search text (case-insensitive); an empty search keeps them all. */
export function filterCountries(countries: readonly CountryOption[], search: string): CountryOption[] {
  const q = search.trim().toLowerCase();
  if (q === '') return [...countries];
  return countries.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
}

/**
 * A country picker you can search: type a name or code to narrow the list, then choose. "Any country" (the empty code) is
 * always offered, and so is the current choice, so narrowing the list never changes the value by itself.
 */
export function CountrySelect({
  value,
  onChange,
  countries,
  label,
  searchLabel,
  anyLabel,
  invalid,
  disabled,
  describedBy,
}: {
  value: string;
  onChange: (code: string) => void;
  countries: readonly CountryOption[];
  label: string;
  searchLabel: string;
  anyLabel: string;
  invalid?: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  const [search, setSearch] = useState('');
  const listId = useId();
  const options = useMemo(() => {
    const found = filterCountries(countries, search);
    const current = countries.find((c) => c.code === value);
    return current && !found.some((c) => c.code === value) ? [current, ...found] : found;
  }, [countries, search, value]);
  return (
    <div className="space-y-1.5">
      <Input
        type="search"
        aria-label={searchLabel}
        placeholder={searchLabel}
        autoComplete="off"
        className="h-8 text-xs"
        value={search}
        disabled={disabled}
        onChange={(e) => setSearch(e.target.value)}
      />
      <Select
        id={listId}
        aria-label={label}
        value={value}
        invalid={invalid}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{anyLabel}</option>
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name} ({c.code})
          </option>
        ))}
      </Select>
    </div>
  );
}
