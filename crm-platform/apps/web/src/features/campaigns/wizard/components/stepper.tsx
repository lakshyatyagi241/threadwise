'use client';

import { useTranslations } from 'next-intl';
import { WIZARD_STEPS, WIZARD_STEP_COUNT } from '@crm/contracts';
import { cn } from '@crm/ui';
import type { WizardView } from '../lib/state';

/**
 * The four steps. On a wide screen: numbered buttons (a step already reached can be opened again); on a phone: "Step 2 of 4 - Audience"
 * with a progress bar. The current step carries `aria-current="step"`.
 */
export function Stepper({
  current,
  reached,
  onGo,
}: {
  current: WizardView;
  /** The furthest step the person has reached. */
  reached: number;
  onGo: (step: WizardView) => void;
}) {
  const t = useTranslations('campaigns.wizard.steps');
  const label = (n: number) => t(WIZARD_STEPS[n - 1]!);
  return (
    <nav aria-label={t('navLabel')}>
      <div className="sm:hidden">
        <p className="text-sm font-medium" data-testid="stepper-compact">
          {t('compact', { current, total: WIZARD_STEP_COUNT, name: label(current) })}
        </p>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={WIZARD_STEP_COUNT}
          aria-valuenow={current}
          aria-label={t('navLabel')}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${(current / WIZARD_STEP_COUNT) * 100}%` }}
          />
        </div>
      </div>
      <ol className="hidden items-center gap-2 sm:flex">
        {WIZARD_STEPS.map((_, i) => {
          const n = (i + 1) as WizardView;
          const active = n === current;
          const reachable = n <= reached;
          return (
            <li key={n} className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                disabled={!reachable}
                onClick={() => onGo(n)}
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-full px-2.5 py-1.5 text-start text-sm outline-none',
                  'focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed',
                  active
                    ? 'bg-brand/10 font-semibold'
                    : reachable
                      ? 'hover:bg-muted'
                      : 'text-muted-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold',
                    active
                      ? 'border-brand bg-brand text-brand-foreground'
                      : n < current
                        ? 'border-brand/40 bg-brand/10 text-brand'
                        : 'border-border text-muted-foreground',
                  )}
                >
                  {n < current ? '✓' : n}
                </span>
                <span className="truncate">{label(n)}</span>
                <span className="sr-only">
                  {t('stepOf', { current: n, total: WIZARD_STEP_COUNT })}
                </span>
              </button>
              {n < WIZARD_STEP_COUNT && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-0.5 min-w-3 flex-1 rounded-full',
                    n < current ? 'bg-brand/50' : 'bg-border',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
