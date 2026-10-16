'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { WIZARD_STEPS, type WizardStep } from '../../lib/wizard-model';
import {
  CalendarIcon,
  CheckIcon,
  ChecklistIcon,
  MessageIcon,
  SlidersIcon,
  UsersIcon,
} from '../icons';

const STEP_ICON = {
  setup: SlidersIcon,
  compose: MessageIcon,
  recipients: UsersIcon,
  schedule: CalendarIcon,
  review: ChecklistIcon,
} as const;

/** The five step dots (each with its own icon, a check once done) joined by a bar. A step is reachable when every step before it has nothing missing. */
export function Stepper({
  current,
  reachable,
  onGo,
}: {
  current: WizardStep;
  reachable: (s: WizardStep) => boolean;
  onGo: (s: WizardStep) => void;
}) {
  const t = useTranslations('campaigns.builder.steps');
  const at = WIZARD_STEPS.indexOf(current);
  return (
    <nav
      aria-label={t('label')}
      className="overflow-x-auto border-b border-border bg-muted/30 px-5 py-4"
    >
      <ol className="flex min-w-[560px] items-center">
        {WIZARD_STEPS.map((s, i) => {
          const done = i < at;
          const active = i === at;
          const last = i === WIZARD_STEPS.length - 1;
          const ok = reachable(s);
          const StepIcon = done ? CheckIcon : STEP_ICON[s];
          return (
            <li key={s} className={cn('flex items-center gap-2.5', !last && 'flex-1')}>
              <button
                type="button"
                disabled={!ok}
                aria-current={active ? 'step' : undefined}
                onClick={() => onGo(s)}
                className="flex items-center gap-2.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] font-mono text-[11px] font-semibold transition',
                    active && 'border-brand bg-background text-brand ring-4 ring-brand/10',
                    done && 'border-brand bg-brand text-background',
                    !active && !done && 'border-border bg-background text-muted-foreground',
                  )}
                >
                  <StepIcon className="size-3.5" />
                </span>
                <span className="sr-only">{i + 1}</span>
                <span
                  className={cn(
                    'whitespace-nowrap text-[11.5px]',
                    active ? 'font-semibold text-brand' : 'font-medium text-muted-foreground',
                  )}
                >
                  {t(`${s}.name`)}
                </span>
              </button>
              {!last && (
                <span
                  aria-hidden
                  className={cn('mx-2 h-[2px] flex-1 rounded', done ? 'bg-brand' : 'bg-border')}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
