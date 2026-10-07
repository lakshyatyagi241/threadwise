'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type {
  WizardEligibility,
  WizardEligibilityCheck,
  WizardEligibilityGroup,
  WizardEligibilityState,
} from '@crm/contracts';
import { cn } from '@crm/ui';
import { formatMinor } from '../lib/money';
import { Chip, ErrorBlock, Skeleton } from './parts';

export interface EligibilityQuery {
  data?: WizardEligibility;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

const TONE = { pass: 'success', warn: 'warning', fail: 'danger' } as const;
const GROUPS = ['contacts', 'template', 'billing'] as const;

/** The state as a shape, not only a colour: a check, a triangle, a cross. */
function StateIcon({ state }: { state: WizardEligibilityState }) {
  const t = useTranslations('campaigns.wizard.eligibility.state');
  const tone = {
    pass: 'text-success',
    warn: 'text-warning',
    fail: 'text-danger',
  }[state];
  const path = {
    pass: 'M5 12.5l4.5 4.5L19 7.5',
    warn: 'M12 8v5m0 3.5v.01M10.3 4.2L3 17.5a2 2 0 001.7 3h14.6a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z',
    fail: 'M6 6l12 12M18 6L6 18',
  }[state];
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-4 shrink-0', tone)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={t(state)}
    >
      <path d={path} />
    </svg>
  );
}

/** The values a message needs, with the money already in the person's currency and language. */
function useWords() {
  const t = useTranslations('campaigns.wizard.eligibility');
  const locale = useLocale();
  return (c: Pick<WizardEligibilityCheck, 'code' | 'values'>): string => {
    const v = c.values;
    const currency = typeof v.currency === 'string' ? v.currency : '';
    const money = (key: string) =>
      typeof v[key] === 'number' && currency ? formatMinor(v[key] as number, currency, locale) : '';
    return t(`code.${c.code}`, {
      ...v,
      balance: money('balanceMinor'),
      estimated: money('estimatedMinor'),
    });
  };
}

function Group({ g }: { g: WizardEligibilityGroup }) {
  const t = useTranslations('campaigns.wizard.eligibility');
  const words = useWords();
  const [open, setOpen] = useState(false);
  const id = useId();
  const reason = words(g);
  const skipped = g.chips.filter(
    (c) => c.key !== 'eligible' && c.key !== 'selected' && c.count > 0,
  );
  return (
    <li className="px-3 py-1.5" data-testid={`eligibility-${g.group}`} data-state={g.state}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StateIcon state={g.state} />
        <h3 className="w-36 shrink-0 text-sm font-medium">{t(`group.${g.group}`)}</h3>
        <p
          className={cn(
            'min-w-0 flex-1 basis-60 text-sm text-muted-foreground',
            !open && 'line-clamp-1',
          )}
          title={reason}
        >
          {reason}
        </p>
        {g.group === 'contacts' &&
          skipped.map((c) => (
            <Chip key={c.key} tone="neutral">
              {t(`chip.${c.key}`, { count: c.count })}
            </Chip>
          ))}
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? t('hideDetails') : t('showDetails')}
        </button>
      </div>
      {open && (
        <ul id={id} className="mt-1.5 space-y-1 border-s border-border ms-2 ps-3">
          {g.checks.map((c, i) => (
            <li key={`${c.code}-${i}`} className="flex items-start gap-2 text-xs">
              <Chip tone={TONE[c.state]} className="shrink-0">
                {t(`state.${c.state}`)}
              </Chip>
              <span className="text-muted-foreground">{words(c)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Can this broadcast really go out: the contacts that can receive it, the template with its number, how it is billed. One slim card. */
export function EligibilityCard({ eligibility }: { eligibility: EligibilityQuery }) {
  const t = useTranslations('campaigns.wizard.eligibility');
  const e = eligibility.data;
  return (
    <section
      id="review-eligibility"
      aria-labelledby="review-eligibility-title"
      className="rounded-xl border border-border bg-background"
    >
      <h2
        id="review-eligibility-title"
        className="border-b border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {t('title')}
      </h2>
      {eligibility.isPending ? (
        <div className="p-3">
          <Skeleton label={t('loading')} lines={3} />
        </div>
      ) : eligibility.isError || !e ? (
        <div className="space-y-1 p-3">
          <ErrorBlock error={eligibility.error} onRetry={() => void eligibility.refetch()} />
          <p className="text-xs text-muted-foreground">{t('unavailable')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {GROUPS.map((k) => (
            <Group key={k} g={e[k]} />
          ))}
        </ul>
      )}
    </section>
  );
}
