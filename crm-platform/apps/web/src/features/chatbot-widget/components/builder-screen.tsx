'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  createWidget,
  KEYS,
  updateWidget,
  useAssistants,
  useDefaultCountry,
  useWidget,
} from '../api/widgets';
import {
  canJump,
  firstProblem,
  fromWidget,
  newState,
  snippetFor,
  toPayload,
  TOTAL_STEPS,
  validateStep,
  type BuilderState,
  type StepNumber,
} from '../lib/builder-model';
import { BuilderPreview } from './builder-preview';
import { LaunchStep, LookStep, SetupStep, VoiceStep } from './builder-steps';
import { BackIcon, CheckIcon, LaunchCheckIcon, NextIcon, PrevIcon } from './icons';
import { PlanPaywall } from './plan-paywall';

const FLASH_MS = 2600;

/** `/chatbot-widgets/create` and `/chatbot-widgets/<id>/edit`: the loader for the edit case. */
export function BuilderScreen({ widgetId }: { widgetId?: string }) {
  const t = useTranslations('chatbotWidget.builder');
  const widget = useWidget(widgetId ?? null);
  if (widgetId === undefined) return <Builder initial={newState()} editing={false} />;
  if (widget.isPending) {
    return (
      <div className="flex justify-center p-16">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  if (widget.isError) {
    const notFound = widget.error instanceof ApiError && widget.error.status === 404;
    return (
      <main className="mx-auto max-w-xl p-8">
        <EmptyState
          title={notFound ? t('notFoundTitle') : t('loadError')}
          message={notFound ? t('notFoundBody') : widget.error.message}
          actions={
            <Link
              href="/chatbot-widgets"
              className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground"
            >
              {t('backToWidgets')}
            </Link>
          }
        />
      </main>
    );
  }
  return <Builder initial={fromWidget(widget.data)} editing />;
}

function Builder({ initial, editing }: { initial: BuilderState; editing: boolean }) {
  const t = useTranslations('chatbotWidget.builder');
  const qc = useQueryClient();
  const { toast } = useToast();
  const canSave = useCan(editing ? 'wgt.widgets.update' : 'wgt.widgets.create');
  const assistants = useAssistants();
  const defaultCountry = useDefaultCountry();

  const [s, setS] = useState<BuilderState>(initial);
  const [current, setCurrent] = useState<StepNumber>(1);
  // An existing widget has been through every step, so every node is open at once.
  const [furthest, setFurthest] = useState<number>(editing ? TOTAL_STEPS : 1);
  const [flash, setFlash] = useState<string | null>(null);
  const [saved, setSaved] = useState(editing);
  const [snippet, setSnippet] = useState<{ embedUrl: string; previewUrl: string } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback(
    (patch: Partial<BuilderState>) => setS((prev) => ({ ...prev, ...patch })),
    [],
  );
  useEffect(() => () => void (flashTimer.current && clearTimeout(flashTimer.current)), []);

  const showStep = (n: number) => {
    if (n < 1 || n > TOTAL_STEPS) return;
    setCurrent(n as StepNumber);
    setFurthest((f) => Math.max(f, n));
  };

  /** Red ring, focus and scroll to the control that failed, then let go of it. */
  const flashField = (field: string) => {
    setFlash(field);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
    // The pane for the failed step is mounted a tick later when the step changed.
    window.setTimeout(() => {
      const el = document.getElementById(`wgt-f-${field}`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 30);
  };

  /** Moving forward from `from` needs that step's rules to hold; returns whether the move may go ahead. */
  const gateForward = (from: number): boolean => {
    const p = validateStep(from, s);
    if (p.ok) return true;
    toast(t(`problem.${p.key}`), 'danger');
    flashField(p.field);
    return false;
  };

  const next = () => {
    if (current < TOTAL_STEPS && gateForward(current)) showStep(current + 1);
  };
  const jump = (target: number) => {
    if (canJump(target, current, furthest) === 'free' || gateForward(current)) showStep(target);
  };

  // QUIRK: reproduced deliberately (TW-WGT-006). Nothing blocks a second click while the first save is in flight: both go out
  // before the widget has an id, so a double click on Launch creates two widgets, as in Reference.
  const save = async (reveal: boolean) => {
    // Every step is checked, so an incomplete draft can never be saved; the first failing step opens.
    const bad = firstProblem(s);
    if (bad) {
      showStep(bad.step);
      toast(t(`problem.${bad.problem.key}`), 'danger');
      flashField(bad.problem.field);
      return;
    }
    try {
      const body = toPayload(s);
      const out =
        s.id === null || s.rowVersion === null
          ? await createWidget(body)
          : await updateWidget(s.id, { ...body, rowVersion: s.rowVersion });
      // The page stays where it is; later saves update the same widget (the address is not rewritten).
      setS((prev) => ({ ...prev, id: out.id, rowVersion: out.rowVersion }));
      setSaved(true);
      void qc.invalidateQueries({ queryKey: KEYS.all });
      if (reveal) {
        showStep(TOTAL_STEPS);
        setSnippet({ embedUrl: out.embedUrl, previewUrl: out.previewUrl });
        toast(t('savedEmbed'), 'success');
      } else {
        toast(t('draftSaved'), 'success');
      }
    } catch (e) {
      const detail = e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.message) : null;
      toast(detail ?? t('saveFailed'), 'danger');
    }
  };

  const copySnippet = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippetFor(snippet.embedUrl));
      toast(t('snippetCopied'), 'success');
    } catch {
      toast(t('clipboardBlocked'), 'info');
    }
  };

  const stepLabels = useMemo(
    () => [t('steps.setup'), t('steps.look'), t('steps.voice'), t('steps.launch')],
    [t],
  );
  const stepProps = { s, set, flash };

  return (
    <>
      {assistants.data?.planLocked && <PlanPaywall />}
      <div className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex max-w-none items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/chatbot-widgets"
              title={t('back')}
              aria-label={t('back')}
              className="flex size-8 items-center justify-center rounded-full border border-border hover:bg-muted"
            >
              <BackIcon className="size-3.5" />
            </Link>
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('crumb')} / {editing ? t('crumbEdit') : t('crumbNew')}
              </div>
              <div className="truncate text-xl leading-tight">
                {editing ? t('titleEdit') : t('titleNew')}{' '}
                <span className="italic text-brand">{t('titleAccent')}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              data-testid="state-pill"
              className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] font-medium"
            >
              {saved ? t('stateSaved') : t('stateDraft')}
            </span>
            {canSave && (
              <button
                type="button"
                id="wgt-save"
                onClick={() => void save(false)}
                className="rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {t('saveDraft')}
              </button>
            )}
          </div>
        </div>
      </div>

      <section className="mx-auto max-w-none px-4 py-6 sm:px-6 lg:px-7">
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_342px]">
          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <nav aria-label={t('stepper')} className="border-b border-border bg-muted/40 px-5 py-4">
              <ol className="flex items-center">
                {([1, 2, 3, 4] as const).map((n) => {
                  const done = n < current;
                  const active = n === current;
                  return (
                    <li
                      key={n}
                      className={cn('flex items-center gap-2.5', n < TOTAL_STEPS && 'flex-1')}
                    >
                      <button
                        type="button"
                        data-step-node={n}
                        aria-current={active ? 'step' : undefined}
                        onClick={() => jump(n)}
                        className="flex items-center gap-2.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <span
                          className={cn(
                            'grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] font-mono text-[11px] font-semibold transition',
                            done && 'border-brand bg-brand text-brand-foreground',
                            active && 'border-brand bg-background text-brand ring-4 ring-brand/10',
                            !done && !active && 'border-border bg-background text-muted-foreground',
                          )}
                        >
                          {done ? <CheckIcon className="size-3" /> : n}
                        </span>
                        <span
                          className={cn(
                            'whitespace-nowrap text-[11.5px]',
                            done && 'font-semibold',
                            active && 'font-semibold text-brand',
                            !done && !active && 'font-medium text-muted-foreground',
                          )}
                        >
                          {stepLabels[n - 1]}
                        </span>
                      </button>
                      {n < TOTAL_STEPS && (
                        <span
                          className={cn(
                            'mx-2 h-[2px] flex-1 rounded',
                            n < current ? 'bg-brand' : 'bg-border',
                          )}
                          aria-hidden="true"
                        />
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>

            <div className="p-5">
              {current === 1 && (
                <SetupStep
                  {...stepProps}
                  assistants={assistants.data?.data ?? []}
                  defaultIso={defaultCountry.data}
                />
              )}
              {current === 2 && <LookStep {...stepProps} />}
              {current === 3 && <VoiceStep {...stepProps} />}
              {current === 4 && (
                <LaunchStep {...stepProps} snippet={snippet} onCopy={() => void copySnippet()} />
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border bg-muted/40 px-5 py-4">
              <button
                type="button"
                id="wgt-prev"
                disabled={current === 1}
                onClick={() => showStep(current - 1)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-2 text-xs font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PrevIcon className="size-3" />
                {t('previous')}
              </button>
              <div className="font-mono text-[11px] text-muted-foreground">
                {t('stepOf', { n: current, total: TOTAL_STEPS })}
              </div>
              <div className="flex items-center gap-2">
                {current < TOTAL_STEPS ? (
                  <button
                    type="button"
                    id="wgt-next"
                    onClick={next}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90"
                  >
                    {t('next')}
                    <NextIcon className="size-3" />
                  </button>
                ) : (
                  canSave && (
                    <Button
                      id="wgt-launch"
                      onClick={() => void save(true)}
                      className="h-auto gap-1.5 rounded-full bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90"
                    >
                      <LaunchCheckIcon className="size-3" />
                      {t('launchWidget')}
                    </Button>
                  )
                )}
              </div>
            </div>
          </div>

          <BuilderPreview s={s} />
        </div>
      </section>
    </>
  );
}
