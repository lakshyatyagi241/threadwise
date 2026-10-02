'use client';

import type { CountryCode } from 'libphonenumber-js';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@crm/ui';
import {
  countryOf,
  countryOptions,
  dialCodeOf,
  flagEmoji,
  nationalDigits,
  openingCountry,
  splitInternational,
} from '../lib/phone';

/**
 * The WhatsApp number: a country picker plus the national digits (TW-WGT-003). The dial code goes to `onCc` as `+<dial>`
 * on every country change, the digits to `onNumber` with everything else stripped, and a pasted international number is
 * re-split on blur so the code is not counted twice. Opens on the platform's default country when nothing is saved.
 */
export function PhoneField({
  id,
  cc,
  number,
  defaultIso,
  onCc,
  onNumber,
  invalid,
}: {
  id: string;
  cc: string;
  number: string;
  defaultIso: string | null | undefined;
  onCc: (cc: string) => void;
  onNumber: (digits: string) => void;
  invalid?: boolean;
}) {
  const t = useTranslations('chatbotWidget.builder.setup');
  const locale = useLocale();
  const options = useMemo(() => countryOptions(locale), [locale]);
  // The platform default arrives after the first paint; it only decides the country while nothing is saved, typed or picked.
  const [picked, setPicked] = useState<CountryCode | null>(null);
  const [text, setText] = useState(number);
  const country = picked ?? countryOf(cc, number, openingCountry(defaultIso));
  const setCountry = (c: CountryCode) => setPicked(c);

  // Reference wrote the dial code of the shown country into the form on load, whatever the engine.
  useEffect(() => {
    const dial = dialCodeOf(country);
    if (cc !== dial) onCc(dial);
    // `cc` is deliberately not a dependency: this only follows the country.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <select
        aria-label={t('country')}
        value={country}
        onChange={(e) => {
          setCountry(e.target.value as CountryCode);
        }}
        className="h-10 rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/10 sm:w-60 sm:shrink-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {flagEmoji(o.value)} {o.label} ({o.dial})
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        autoComplete="off"
        inputMode="tel"
        value={text}
        aria-invalid={invalid || undefined}
        placeholder={t('phonePlaceholder')}
        onChange={(e) => {
          setText(e.target.value);
          onNumber(nationalDigits(e.target.value));
        }}
        onBlur={() => {
          const split = splitInternational(text);
          if (!split) return;
          setCountry(split.country);
          setText(split.national);
          onCc(dialCodeOf(split.country));
          onNumber(nationalDigits(split.national));
        }}
        className={cn(
          'h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[13px] outline-none',
          'focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/10',
          invalid ? 'border-danger ring-2 ring-danger/40' : 'border-border',
        )}
      />
    </div>
  );
}
