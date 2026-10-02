'use client';

import { cn } from '@crm/ui';
import { useTranslations } from 'next-intl';

const STEPS = ['account', 'workspace', 'plan'] as const;

/**
 * The three-step progress list under the sign-up title: Account, Workspace, Plan. The current step is a filled
 * green dot, finished steps a dot with a tick, and later steps a pale dot. (The "Step 1 of 3" wording sits in
 * the mono line above the title.)
 */
export function StepList({ current = 1, className }: { current?: 1 | 2 | 3; className?: string }) {
  const t = useTranslations('auth-registration-security.guest.signup.steps');
  return (
    <ol
      aria-label={t('label')}
      className={cn(
        'flex items-center gap-2 font-mono rtl:font-sans text-[10.5px] uppercase tracking-wider rtl:tracking-normal',
        className,
      )}
    >
      {STEPS.map((step, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        return (
          <li
            key={step}
            className="flex items-center gap-2"
            aria-current={active ? 'step' : undefined}
          >
            {i > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  'h-px w-4',
                  // Finished stretch: deep green; the stretch leaving the current step: paper; the rest: paler.
                  n - 1 < current
                    ? 'bg-(--auth-deep)'
                    : n - 1 === current
                      ? 'bg-(--auth-paper-300)'
                      : 'bg-(--auth-paper-200)',
                )}
              />
            )}
            <span
              className={cn(
                'flex items-center gap-1.5',
                active ? 'text-(--auth-link)' : 'text-(--auth-ink-500)',
              )}
            >
              <span
                className={cn(
                  'grid size-5 place-items-center rounded-full text-[10px]',
                  active && 'bg-(--auth-deep) text-(--auth-light)',
                  done && 'bg-(--auth-mint) text-(--auth-link)',
                  !active && !done && 'bg-(--auth-paper-100) text-(--auth-ink-500)',
                )}
              >
                {done ? (
                  <svg
                    viewBox="0 0 16 16"
                    className="size-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M3 8l3 3 7-7" />
                  </svg>
                ) : (
                  n
                )}
              </span>
              {t(step)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
