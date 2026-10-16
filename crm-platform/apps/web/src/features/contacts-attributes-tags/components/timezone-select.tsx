'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@crm/ui';
import { timezoneList } from '@/lib/timezones';

/**
 * The IANA time zone picker of a contact (BL-193): the browser's own list of zones, never a typed name, with one extra first choice
 * that means "no zone stored" (the contact is then read on the country of its number, then on the workspace's fallback). `emptyLabel`
 * overrides what that first choice says (the bulk edit says "Leave as it is", the filter says "Any").
 */
export function TimezoneSelect({
  id,
  value,
  onChange,
  emptyLabel,
  disabled,
  extra,
}: {
  id?: string;
  /** The zone, or '' for none. */
  value: string;
  onChange: (zone: string) => void;
  emptyLabel?: string;
  disabled?: boolean;
  /** Further choices placed after the empty one (the filter's "No time zone set"). */
  extra?: ReadonlyArray<{ value: string; label: string }>;
}) {
  const t = useTranslations('contacts-attributes-tags.timezone');
  const zones = useMemo(() => {
    const isChoice = (extra ?? []).some((x) => x.value === value);
    return timezoneList(value && !isChoice ? value : undefined);
  }, [value, extra]);
  return (
    <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel ?? t('useAuto')}</option>
      {(extra ?? []).map((x) => (
        <option key={x.value} value={x.value}>
          {x.label}
        </option>
      ))}
      {zones.map((z) => (
        <option key={z} value={z}>
          {z}
        </option>
      ))}
    </Select>
  );
}
