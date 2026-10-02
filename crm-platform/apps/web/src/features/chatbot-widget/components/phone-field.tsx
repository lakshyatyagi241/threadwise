'use client';

import intlTelInput from 'intl-tel-input/intlTelInputWithUtils';
import 'intl-tel-input/styles';
import { useEffect, useRef } from 'react';
import { cn } from '@crm/ui';
import { nationalDigits, openingCountry } from '../lib/phone';

type Iti = ReturnType<typeof intlTelInput>;
type InitialCountry = NonNullable<Parameters<typeof intlTelInput>[1]>['initialCountry'];

/**
 * The WhatsApp number as WaDesk shows it (WD-WGT-003): the same country picker (intl-tel-input, flag and separate dial code).
 * The dial code goes to `onCc` as `+<dial>` on every country change, the digits to `onNumber` with everything else stripped,
 * and on blur a pasted international number is re-split so the code is not counted twice. A saved cc + number is seeded
 * through `setNumber`. Opens on the platform's default country (fallback India).
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
  const input = useRef<HTMLInputElement>(null);
  const iti = useRef<Iti | null>(null);
  // The picker is mounted once; later prop changes must not rebuild it, so its callbacks read the latest ones.
  const live = useRef({ cc, onCc, onNumber });
  useEffect(() => {
    live.current = { cc, onCc, onNumber };
  });
  const seed = useRef({ cc, number, defaultIso });

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const s = seed.current;
    const picker = intlTelInput(el, {
      initialCountry: openingCountry(s.defaultIso).toLowerCase() as InitialCountry,
      separateDialCode: true,
      nationalMode: false,
      autoPlaceholder: 'aggressive',
      // The builder card clips its overflow; the country list is portalled out of it, as in WaDesk.
      dropdownContainer: document.body,
    });
    iti.current = picker;

    const seedCc = s.cc.replace(/[^\d+]/g, '');
    const seedNumber = nationalDigits(s.number);
    if (seedCc && seedNumber) {
      const e164 = `${seedCc.startsWith('+') ? seedCc : `+${seedCc}`}${seedNumber}`;
      try {
        picker.setNumber(e164);
      } catch {
        el.value = seedNumber;
      }
    }

    const syncCountry = () => {
      const data = picker.getSelectedCountryData();
      if (data?.dialCode) live.current.onCc(`+${data.dialCode}`);
    };
    const syncNumber = () => live.current.onNumber(nationalDigits(el.value));
    const onBlur = () => {
      try {
        const e164 = picker.getNumber();
        if (e164) {
          const code = live.current.cc;
          const stripped = e164.startsWith(code)
            ? e164.slice(code.length)
            : e164.replace(/^\+\d+/, '');
          live.current.onNumber(nationalDigits(stripped));
        }
      } catch {
        /* keep the raw digits */
      }
    };
    el.addEventListener('countrychange', syncCountry);
    el.addEventListener('input', syncNumber);
    el.addEventListener('blur', onBlur);
    syncCountry();
    syncNumber();
    return () => {
      el.removeEventListener('countrychange', syncCountry);
      el.removeEventListener('input', syncNumber);
      el.removeEventListener('blur', onBlur);
      picker.destroy();
      iti.current = null;
    };
  }, []);

  return (
    <div className="[&_.iti]:w-full">
      <input
        ref={input}
        id={id}
        type="tel"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        placeholder="Your number without country code"
        className={cn(
          'h-10 w-full rounded-xl border bg-background px-3 text-[13px] outline-none',
          'focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/10',
          invalid ? 'border-danger ring-2 ring-danger/40' : 'border-border',
        )}
      />
    </div>
  );
}
