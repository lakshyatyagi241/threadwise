'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { CheckIcon } from '../../shared/icons';

const STEPS = ['account', 'workspace', 'plan'] as const;

/** "Step 2 of 3 / Workspace": the account step is already done by the time anyone sees this. */
export function Stepper({ current }: { current: 2 | 3 }) {
  const t = useTranslations('auth-registration-security.account.onboarding.stepper');
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t('label', { current, total: STEPS.length, name: t(STEPS[current - 1]!) })}
      </p>
      <ol className="flex items-center gap-2 text-xs font-medium" aria-label={t('progress')}>
        {STEPS.map((step, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          return (
            <li
              key={step}
              className="flex items-center gap-2"
              aria-current={active ? 'step' : undefined}
            >
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={cn('h-px w-6 sm:w-10', n <= current ? 'bg-primary' : 'bg-border')}
                />
              )}
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-xs',
                  done && 'bg-primary/15 text-primary',
                  active && 'bg-primary text-primary-foreground',
                  !done && !active && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <CheckIcon className="size-3.5" /> : n}
              </span>
              <span className={cn(active ? 'text-foreground' : 'text-muted-foreground')}>
                {t(step)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
