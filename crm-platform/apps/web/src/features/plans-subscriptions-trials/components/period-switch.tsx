'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { Period } from '../lib/format';

/** The Monthly / Yearly pill (TW-PLAN-011). Rendered only when the platform setting is on and some plan has a yearly price. */
export function PeriodSwitch({
  value,
  onChange,
  discountPct,
}: {
  value: Period;
  onChange: (p: Period) => void;
  discountPct: number;
}) {
  const t = useTranslations('plans-subscriptions-trials.plans.period');
  const options: Period[] = ['monthly', 'yearly'];
  return (
    <div
      role="radiogroup"
      aria-label={t('label')}
      data-testid="period-switch"
      className="inline-flex rounded-full border border-border bg-muted p-1 text-sm"
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={cn(
            'rounded-full px-4 py-1.5 font-medium focus-visible:ring-2 focus-visible:ring-primary',
            value === o ? 'bg-background shadow-sm' : 'text-muted-foreground',
          )}
        >
          {t(o)}
          {o === 'yearly' && discountPct > 0 && (
            <span className="ms-1.5 text-xs text-success">{t('save', { pct: discountPct })}</span>
          )}
        </button>
      ))}
    </div>
  );
}
