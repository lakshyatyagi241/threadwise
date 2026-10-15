'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { VARIANT_IDS } from '../lib/auth-pages-draft';

/** A 16:10 schematic of each design, drawn from theme tokens so it reads in light and dark. */
function Thumb({ variant }: { variant: number }) {
  const card = { fill: 'var(--background)', stroke: 'var(--border)', strokeWidth: 1 } as const;
  return (
    <svg
      viewBox="0 0 80 50"
      className="block aspect-[16/10] w-full rounded border border-border"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="80" height="50" fill="var(--muted)" />
      {variant === 1 && (
        <>
          <rect width="40" height="50" fill="var(--primary)" opacity="0.85" />
          <rect x="5" y="8" width="22" height="3" rx="1.5" fill="var(--background)" opacity="0.9" />
          <rect x="5" y="15" width="30" height="2" rx="1" fill="var(--background)" opacity="0.5" />
          <rect x="5" y="30" width="9" height="9" rx="2" fill="var(--background)" opacity="0.35" />
          <rect x="17" y="30" width="9" height="9" rx="2" fill="var(--background)" opacity="0.35" />
          <rect x="29" y="30" width="9" height="9" rx="2" fill="var(--background)" opacity="0.35" />
          <rect x="48" y="12" width="24" height="26" rx="3" {...card} />
          <rect x="52" y="18" width="16" height="3" rx="1.5" fill="var(--border)" />
          <rect x="52" y="25" width="16" height="3" rx="1.5" fill="var(--border)" />
          <rect x="52" y="32" width="16" height="3" rx="1.5" fill="var(--primary)" />
        </>
      )}
      {variant === 2 && (
        <>
          <rect width="80" height="50" fill="var(--primary)" opacity="0.8" />
          <circle cx="62" cy="14" r="12" fill="var(--background)" opacity="0.18" />
          <rect x="24" y="10" width="32" height="30" rx="3" {...card} />
          <rect x="29" y="17" width="22" height="3" rx="1.5" fill="var(--border)" />
          <rect x="29" y="24" width="22" height="3" rx="1.5" fill="var(--border)" />
          <rect x="29" y="31" width="22" height="3" rx="1.5" fill="var(--primary)" />
        </>
      )}
      {variant === 3 && (
        <>
          <rect x="24" y="8" width="32" height="34" rx="3" {...card} />
          <rect x="24" y="8" width="32" height="2.5" rx="1" fill="var(--primary)" />
          <rect x="29" y="17" width="22" height="3" rx="1.5" fill="var(--border)" />
          <rect x="29" y="24" width="22" height="3" rx="1.5" fill="var(--border)" />
          <rect x="29" y="32" width="22" height="3" rx="1.5" fill="var(--primary)" />
        </>
      )}
      {variant === 4 && (
        <>
          <rect width="30" height="50" fill="var(--primary)" />
          <rect
            x="4"
            y="9"
            width="18"
            height="3"
            rx="1.5"
            fill="var(--primary-foreground)"
            opacity="0.9"
          />
          <rect
            x="4"
            y="16"
            width="22"
            height="2"
            rx="1"
            fill="var(--primary-foreground)"
            opacity="0.55"
          />
          <rect x="42" y="12" width="28" height="26" rx="3" {...card} />
          <rect x="47" y="18" width="18" height="3" rx="1.5" fill="var(--border)" />
          <rect x="47" y="25" width="18" height="3" rx="1.5" fill="var(--border)" />
          <rect x="47" y="32" width="18" height="3" rx="1.5" fill="var(--primary)" />
        </>
      )}
      {variant === 5 && (
        <>
          <circle cx="16" cy="12" r="20" fill="var(--primary)" opacity="0.3" />
          <circle cx="68" cy="38" r="22" fill="var(--primary)" opacity="0.22" />
          <rect
            x="24"
            y="10"
            width="32"
            height="30"
            rx="4"
            fill="var(--background)"
            opacity="0.8"
            stroke="var(--border)"
          />
          <rect x="29" y="17" width="22" height="3" rx="1.5" fill="var(--border)" />
          <rect x="29" y="24" width="22" height="3" rx="1.5" fill="var(--border)" />
          <rect x="29" y="31" width="22" height="3" rx="1.5" fill="var(--primary)" />
        </>
      )}
      {variant === 6 && (
        <>
          <rect x="40" y="0" width="40" height="50" fill="var(--primary)" opacity="0.9" />
          <rect
            x="48"
            y="8"
            width="7"
            height="7"
            rx="1.5"
            fill="var(--background)"
            opacity="0.5"
            transform="rotate(20 51 11)"
          />
          <circle cx="72" cy="44" r="14" fill="var(--background)" opacity="0.14" />
          <rect x="46" y="16" width="20" height="3" rx="1.5" fill="var(--background)" opacity="0.9" />
          <rect x="46" y="34" width="10" height="2" rx="1" fill="var(--background)" opacity="0.6" />
          <rect x="46" y="39" width="10" height="2" rx="1" fill="var(--background)" opacity="0.6" />
          <rect x="6" y="12" width="26" height="26" rx="3" {...card} />
          <rect x="10" y="18" width="18" height="3" rx="1.5" fill="var(--border)" />
          <rect x="10" y="25" width="18" height="3" rx="1.5" fill="var(--border)" />
          <rect x="10" y="32" width="18" height="3" rx="1.5" fill="var(--primary)" />
        </>
      )}
    </svg>
  );
}

const NAMES = ['split', 'cinematic', 'minimal', 'spotlight', 'aurora', 'geta'] as const;

/** The five designs, one choice for all three auth pages. Native radios, so arrow keys and the screen reader work. */
export function DesignPicker({
  value,
  onChange,
  disabled,
  error,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
  error?: string;
}) {
  const t = useTranslations('auth-registration-security.platform.authPages.designs');
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2 border-0 p-0">
      <legend className="mb-1 text-sm font-medium">
        {t('legend')} <span className="font-normal text-muted-foreground">{t('legendNote')}</span>
      </legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {VARIANT_IDS.map((id) => (
          <label
            key={id}
            className={cn(
              'block cursor-pointer space-y-2 rounded-md border p-2.5 transition',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
              value === id
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                : 'border-border hover:border-primary/40',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name="auth-design"
              id={id === 1 ? 'ap-variant' : undefined}
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
              className="sr-only"
            />
            <Thumb variant={id} />
            <span className="block text-xs font-semibold leading-tight">
              {t(`${NAMES[id - 1]}.name`)}
            </span>
            <span className="block text-[11px] leading-snug text-muted-foreground">
              {t(`${NAMES[id - 1]}.description`)}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
