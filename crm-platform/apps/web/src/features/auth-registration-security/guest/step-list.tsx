'use client';

import { cn } from '@crm/ui';
import { useTranslations } from 'next-intl';

const STEPS = ['account', 'workspace', 'plan'] as const;

/** The three-step progress list shown on sign-up: Account (this screen), Workspace, Plan. */
export function StepList({ current = 1 }: { current?: 1 | 2 | 3 }) {
  const t = useTranslations('auth-registration-security.guest.signup.steps');
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t('position', { current, total: STEPS.length })}
      </p>
      <ol aria-label={t('label')} className="flex items-center gap-2 text-xs">
        {STEPS.map((step, i) => {
          const n = i + 1;
          const active = n === current;
          return (
            <li
              key={step}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-muted',
                )}
              >
                {n}
              </span>
              <span
                className={cn(
                  'uppercase tracking-wide rtl:tracking-normal',
                  active && 'font-semibold',
                )}
              >
                {t(step)}
              </span>
              {n < STEPS.length && <span aria-hidden="true" className="h-px w-4 bg-border" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
