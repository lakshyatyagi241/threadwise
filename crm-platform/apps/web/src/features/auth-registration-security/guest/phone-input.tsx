'use client';

import { cn } from '@crm/ui';
import type { CountryCode } from 'libphonenumber-js';
import { getCountryCallingCode } from 'libphonenumber-js';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import {
  countryFromInternational,
  evaluatePhone,
  flagEmoji,
  formatNational,
  listCountries,
  type PhoneState,
} from './phone';
import { useIsClient } from './use-is-client';

export interface PhoneValue {
  raw: string;
  iso: CountryCode;
  state: PhoneState;
}

/**
 * International phone field: a country picker (native select, so type-ahead and mobile pickers work)
 * beside the national number. Produces E.164 through libphonenumber-js (WD-AUTH-005). Typing or pasting
 * "+44 ..." switches the country; formatting is applied on blur so editing never fights the caret.
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
  const isClient = useIsClient();
  // Country names come from the browser's ICU data, so the full list renders after hydration.
  const countries = useMemo(() => (isClient ? listCountries(locale) : []), [isClient, locale]);
  const dial = getCountryCallingCode(value.iso);

  function update(raw: string, iso: CountryCode) {
    onChange({ raw, iso, state: evaluatePhone(raw, iso) });
  }

  return (
    <div
      className={cn(
        'flex h-10 w-full items-stretch rounded-md border bg-background text-sm text-foreground',
        'focus-within:ring-2 focus-within:ring-primary',
        invalid ? 'border-danger' : 'border-border',
      )}
    >
      <div className="relative shrink-0 border-e border-border">
        <span
          aria-hidden="true"
          className="pointer-events-none flex h-full items-center gap-1.5 px-3"
        >
          <span className="text-base leading-none">{flagEmoji(value.iso)}</span>
          <span dir="ltr" className="text-muted-foreground">
            +{dial}
          </span>
          <svg
            viewBox="0 0 12 12"
            className="size-3 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M2 4l4 4 4-4" />
          </svg>
        </span>
        <select
          aria-label={t('country')}
          value={value.iso}
          onChange={(e) => update(value.raw, e.target.value as CountryCode)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        >
          {countries.length === 0 ? (
            <option value={value.iso}>{value.iso}</option>
          ) : (
            countries.map((c) => (
              <option key={c.iso} value={c.iso}>
                {c.flag} {c.name} (+{c.dial})
              </option>
            ))
          )}
        </select>
      </div>
      <input
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
        className="min-w-0 flex-1 bg-transparent px-3 text-start outline-none"
      />
    </div>
  );
}
