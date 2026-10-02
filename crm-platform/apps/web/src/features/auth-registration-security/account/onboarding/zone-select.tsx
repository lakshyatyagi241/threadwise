'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Combobox, type ComboboxOption } from '../../shared/combobox';
import { modernZoneId, supportedTimeZones } from '../../shared/timezones';

/**
 * Searchable timezone picker of the workspace step: every IANA zone listed by its id alone ("Asia/Kolkata"), in
 * alphabetical order, with a "Search timezone..." prompt. The current value and the platform default are always
 * offered, even when the browser's list lacks them.
 */
export function ZoneSelect({
  id,
  value,
  onChange,
  extra = [],
  invalid,
}: {
  id: string;
  value: string;
  onChange: (zone: string) => void;
  extra?: ReadonlyArray<string | null | undefined>;
  invalid?: boolean;
}) {
  const t = useTranslations('auth-registration-security.gate.onboarding');
  const normalized = modernZoneId(value);
  // `extra` is a fresh array every render; its content decides.
  const extraKey = extra.join('|');
  const options = useMemo(
    () => zoneOptions([normalized, ...extraKey.split('|')]),
    [normalized, extraKey],
  );
  return (
    <Combobox
      id={id}
      options={options}
      value={normalized}
      onChange={onChange}
      placeholder={t('timezonePlaceholder')}
      emptyLabel={t('timezoneEmpty')}
      listLabel={t('timezoneLabel')}
      invalid={invalid}
    />
  );
}

/** One option per zone, labelled with the bare id, sorted by it. Exported for tests. */
export function zoneOptions(
  extra: ReadonlyArray<string | null | undefined> = [],
  zones: readonly string[] = supportedTimeZones(),
): ComboboxOption[] {
  const all = new Set(zones);
  for (const z of extra) if (z) all.add(modernZoneId(z));
  return [...all]
    .sort((a, b) => a.localeCompare(b))
    .map((zone) => ({ value: zone, label: zone, search: zone.toLowerCase().replace(/_/g, ' ') }));
}
