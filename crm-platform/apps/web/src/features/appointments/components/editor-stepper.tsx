'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { STEPS, type Step } from '../lib/booking-form';
import { CheckIcon } from './icons';

/**
 * The five steps as a row: a dot with its number, the name, and a bar to the next one. Every step is a button (WaDesk lets you
 * click any of them; moving forward is checked by the screen). A step with a problem is marked, a finished one shows a tick.
 */
export function EditorStepper({
  current,
  withProblems,
  onGo,
}: {
  current: Step;
  /** Steps that hold a problem the person has been shown. */
  withProblems: ReadonlySet<Step>;
  onGo: (step: Step) => void;
}) {
  const t = useTranslations('appointments.editor.steps');
  const at = STEPS.indexOf(current);

  return (
    <nav
      aria-label={t('label')}
      className="thin-scrollbar overflow-x-auto border-b border-border bg-muted/30 px-4 py-3 sm:px-5"
    >
      <ol className="flex items-center">
        {STEPS.map((step, i) => {
          const done = i < at;
          const isCurrent = i === at;
          const problem = withProblems.has(step) && !isCurrent;
          const last = i === STEPS.length - 1;
          return (
            <li key={step} className={cn('flex items-center', !last && 'flex-1')}>
              <button
                type="button"
                onClick={() => onGo(step)}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={problem ? `${t(step)} — ${t('hasProblem')}` : t(step)}
                className="group flex items-center gap-2 rounded-full pe-1 outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border-[1.5px] text-xs font-semibold tabular-nums transition',
                    isCurrent &&
                      'border-brand bg-background text-brand ring-4 ring-brand/10 dark:border-primary dark:text-primary',
                    done && !problem && 'border-brand bg-brand text-brand-foreground',
                    !isCurrent &&
                      !done &&
                      !problem &&
                      'border-border bg-background text-muted-foreground group-hover:border-foreground/40',
                    problem && 'border-danger bg-danger/10 text-danger',
                  )}
                >
                  {done && !problem ? <CheckIcon className="size-3.5" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'whitespace-nowrap text-xs',
                    isCurrent
                      ? 'font-semibold text-foreground'
                      : 'hidden font-medium text-muted-foreground sm:inline',
                    problem && 'text-danger',
                  )}
                >
                  {t(step)}
                </span>
              </button>
              {!last && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'mx-1.5 h-0.5 min-w-2 flex-1 rounded',
                    done ? 'bg-brand' : 'bg-border',
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
