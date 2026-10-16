'use client';

import { useTranslations } from 'next-intl';
import { WIZARD_STEPS, WIZARD_STEP_COUNT } from '@crm/contracts';
import { cn } from '@crm/ui';
import {
  CheckIcon,
  ChecklistIcon,
  SendIcon,
  TemplateIcon,
  UsersIcon,
} from '../../components/icons';
import type { WizardView } from '../lib/state';

const STEP_ICON = {
  template: TemplateIcon,
  audience: UsersIcon,
  review: ChecklistIcon,
  send: SendIcon,
} as const;

/**
 * The four steps. On a wide screen: buttons with each step's icon, or a check once it is done (a step already reached can be opened again); on a phone: "Step 2 of 4 - Audience"
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
        <p className="flex items-center gap-2 text-sm font-medium" data-testid="stepper-compact">
          {(() => {
            const Icon = STEP_ICON[WIZARD_STEPS[current - 1]!];
            return <Icon className="size-4 text-brand" />;
          })()}
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
          const StepIcon = n < current ? CheckIcon : STEP_ICON[WIZARD_STEPS[i]!];
          return (
            <li key={n} className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                disabled={!reachable}
                onClick={() => onGo(n)}
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm outline-none',
                  'focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed',
                  active ? 'font-semibold' : reachable ? 'hover:bg-muted' : 'text-muted-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                    active
                      ? 'border-brand bg-brand text-brand-foreground'
                      : n < current
                        ? 'border-brand/40 bg-brand/10 text-brand'
                        : 'border-border text-muted-foreground',
                  )}
                >
                  <StepIcon className="size-3.5" />
                </span>
                <span className="truncate">{label(n)}</span>
                <span className="sr-only">
                  {t('stepOf', { current: n, total: WIZARD_STEP_COUNT })}
                </span>
              </button>
              {n < WIZARD_STEP_COUNT && (
                <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
