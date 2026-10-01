'use client';

import { registrationConfigResponseSchema } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import type { CountryCode } from 'libphonenumber-js';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Input } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { Combobox } from './combobox';
import { countryOptions, defaultCountry, splitE164, toE164, type PhoneProblem } from './phone';

export interface PhoneValue {
  /** E.164, or null when the box is empty or the number is not valid. */
  e164: string | null;
  /** True when the box is empty. */
  empty: boolean;
  problem: PhoneProblem | null;
}

interface Props {
  id?: string;
  /** The saved number (E.164) the field opens with. */
  initial?: string | null;
  onChange: (value: PhoneValue) => void;
  invalid?: boolean;
  'aria-describedby'?: string;
}

/**
 * Phone number with a country picker (WD-AUTH-025). The person types a local
 * number and picks a country (or types an international "+" number); the form
 * always receives E.164 or a reason it is not valid. WaDesk used intl-tel-input
 * and stored a separate country code; here the number is one E.164 string.
 */
export function PhoneField({ id, initial, onChange, invalid, ...aria }: Props) {
  const t = useTranslations('auth-registration-security.account.phone');
  const locale = useLocale();
  const start = useMemo(() => splitE164(initial), [initial]);
  const [country, setCountry] = useState<CountryCode | null>(start.country);
  const [national, setNational] = useState(start.national);

  // Only asked for when there is no saved number to take the country from.
  const config = useQuery({
    queryKey: ['auth', 'registration-config'],
    queryFn: () =>
      apiFetch('/auth/registration-config', { schema: registrationConfigResponseSchema }),
    staleTime: Infinity,
    enabled: start.country === null,
    retry: false,
  });
  const fallback = defaultCountry(
    config.data?.defaultCountryIso,
    typeof navigator === 'undefined' ? undefined : navigator.language,
  );
  const active = country ?? fallback;
  const options = useMemo(() => countryOptions(locale), [locale]);

  function emit(text: string, c: CountryCode) {
    const { e164, problem } = toE164(text, c);
    onChange({ e164, empty: text.trim() === '', problem });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Combobox
        className="sm:w-60 sm:shrink-0"
        options={options}
        value={active}
        onChange={(v) => {
          setCountry(v as CountryCode);
          emit(national, v as CountryCode);
        }}
        placeholder={t('countryPlaceholder')}
        emptyLabel={t('countryEmpty')}
        aria-label={t('country')}
        invalid={invalid}
      />
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        dir="ltr"
        value={national}
        onChange={(e) => {
          setNational(e.target.value);
          emit(e.target.value, active);
        }}
        invalid={invalid}
        aria-describedby={aria['aria-describedby']}
        placeholder={t('numberPlaceholder')}
        aria-label={t('number')}
        className="min-w-0 flex-1 text-start"
      />
    </div>
  );
}
