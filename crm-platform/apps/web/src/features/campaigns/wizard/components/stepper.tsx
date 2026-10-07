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
      <ol className="hidden gap-3 sm:grid sm:grid-cols-4">
        {WIZARD_STEPS.map((_, i) => {
          const n = (i + 1) as WizardView;
          const active = n === current;
          const done = n < current;
          const reachable = n <= reached;
          return (
            <li key={n} className="min-w-0">
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                disabled={!reachable}
                onClick={() => onGo(n)}
                className={cn(
                  'group relative flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl border px-3.5 py-2.5 text-start outline-none transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed',
                  active
                    ? 'border-brand bg-brand/5 shadow-sm'
                    : done
                      ? 'border-border bg-background hover:border-brand/50 hover:bg-brand/5'
                      : reachable
                        ? 'border-border bg-background hover:bg-muted'
                        : 'border-dashed border-border bg-muted/30 text-muted-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold',
                    active
                      ? 'bg-brand text-brand-foreground shadow'
                      : done
                        ? 'bg-success text-white'
                        : 'border border-border bg-background text-muted-foreground',
                  )}
                >
                  {done ? '✓' : n}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block truncate text-sm',
                      active ? 'font-semibold' : 'font-medium',
                    )}
                  >
                    {label(n)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t('stepOf', { current: n, total: WIZARD_STEP_COUNT })}
                  </span>
                </span>
                {active && (
                  <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-brand" />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
