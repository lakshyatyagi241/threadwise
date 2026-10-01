'use client';

import { useTranslations } from 'next-intl';
import { Combobox } from './combobox';
import { modernZoneId, timezoneOptions } from './timezones';

interface Props {
  id?: string;
  value: string;
  onChange: (zone: string) => void;
  /** Zones to offer even if the browser does not list them (the saved value, the platform default). */
  extra?: ReadonlyArray<string | null | undefined>;
  invalid?: boolean;
  disabled?: boolean;
  'aria-describedby'?: string;
}

/** Searchable timezone picker: every IANA zone with its current UTC offset ("Asia/Kolkata (UTC+05:30)"). */
export function TimezoneCombobox({
  id,
  value,
  onChange,
  extra = [],
  invalid,
  disabled,
  ...aria
}: Props) {
  const t = useTranslations('auth-registration-security.account.timezone');
  const normalized = modernZoneId(value);
  return (
    <Combobox
      id={id}
      options={timezoneOptions([normalized, ...extra])}
      value={normalized}
      onChange={onChange}
      placeholder={t('placeholder')}
      emptyLabel={t('empty')}
      listLabel={t('label')}
      aria-describedby={aria['aria-describedby']}
      invalid={invalid}
      disabled={disabled}
    />
  );
}
