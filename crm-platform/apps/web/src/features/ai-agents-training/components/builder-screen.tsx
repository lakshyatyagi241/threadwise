'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  createAssistant,
  KEYS,
  updateAssistant,
  useAssistant,
  useEnabledModels,
} from '../api/training';
import {
  canJump,
  firstProblem,
  fromAssistant,
  newState,
  STEP_KEYS,
  toPayload,
  TOTAL_STEPS,
  validateStep,
  type BuilderState,
  type StepNumber,
} from '../lib/builder-model';
import { BrainStep, IdentityStep, PersonaStep, SafetyStep } from './builder-steps';
import { BackIcon, CheckIcon, NextIcon, PrevIcon } from './icons';
import { KnowledgeStep } from './knowledge-step';
import { PlanPaywall } from './plan-paywall';

const FLASH_MS = 2600;
const isPlanLocked = (e: unknown) => e instanceof ApiError && e.code === 'PLAN_FEATURE_LOCKED';

/** `/ai-training/create` and `/ai-training/<id>/edit`: the loader for the edit case. */
export function BuilderScreen({ assistantId }: { assistantId?: string }) {
  const t = useTranslations('aiTraining.builder');
  const assistant = useAssistant(assistantId ?? null);
  if (assistantId === undefined) return <Builder initial={newState()} editing={false} />;
  if (assistant.isPending) {
    return (
      <div className="flex justify-center p-16">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  if (assistant.isError) {
    const notFound = assistant.error instanceof ApiError && assistant.error.status === 404;
    return (
      <main className="mx-auto max-w-xl p-8">
        {isPlanLocked(assistant.error) && <PlanPaywall />}
        <EmptyState
          title={notFound ? t('notFoundTitle') : t('loadError')}
          message={notFound ? t('notFoundBody') : assistant.error.message}
          actions={
            <Link
              href="/ai-training"
              className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground"
            >
              {t('backToList')}
            </Link>
          }
        />
      </main>
    );
  }
  return <Builder initial={fromAssistant(assistant.data)} editing />;
}

function Builder({ initial, editing }: { initial: BuilderState; editing: boolean }) {
  const t = useTranslations('aiTraining.builder');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  // Knowledge entries are written with the update key (an assistant that was just created by this person is theirs to fill).
  const canUpdate = useCan('aiag.training.update');
  const canCreate = useCan('aiag.training.create');
  const canSave = editing ? canUpdate : canCreate;
  const canKnowledge = canUpdate;
  const models = useEnabledModels();

  const [s, setS] = useState<BuilderState>(initial);
  const [current, setCurrent] = useState<StepNumber>(1);
  // An existing assistant has been through every step, so every node is open at once.
  const [furthest, setFurthest] = useState<number>(editing ? TOTAL_STEPS : 1);
  const [flash, setFlash] = useState<string | null>(null);
  const [saved, setSaved] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback((patch: Partial<BuilderState>) => {
    setS((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }, []);
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
    // The pane of the failed step is mounted a tick later when the step changed.
    window.setTimeout(() => {
      const el = document.getElementById(`aiag-f-${field}`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 30);
  };

  const gateForward = (from: number): boolean => {
    const p = validateStep(from, s);
    if (p.ok) return true;
    toast(t(`problem.${p.key}`), 'danger');
    flashField(p.field);
    return false;
  };

  /** Creates or updates; later saves update the same assistant with the row version of the last one. */
  const persist = async () => {
    const body = toPayload(s);
    const out =
      s.id === null || s.rowVersion === null
        ? await createAssistant(body)
        : await updateAssistant(s.id, { ...body, rowVersion: s.rowVersion });
    setS((prev) => ({ ...prev, id: out.id, rowVersion: out.rowVersion }));
    setSaved(true);
    void qc.invalidateQueries({ queryKey: KEYS.list });
    return out;
  };

  const failed = (e: unknown) => {
    if (isPlanLocked(e)) return setLocked(true);
    if (e instanceof ApiError && e.isRowVersionConflict) return toast(t('conflict'), 'danger');
    const detail = e instanceof ApiError ? (e.fieldErrors[0]?.message ?? e.message) : null;
    toast(detail ?? t('saveFailed'), 'danger');
  };

  /** Every step is checked, so an incomplete draft is never saved; the first failing step opens. Returns whether it saved. */
  const save = async (silent: boolean): Promise<boolean> => {
    if (saving) return false;
    const bad = firstProblem(s);
    if (bad) {
      showStep(bad.step);
      toast(t(`problem.${bad.problem}`), 'danger');
      flashField(bad.field);
      return false;
    }
    setSaving(true);
    try {
      await persist();
      if (!silent) toast(t('saved'), 'success');
      return true;
    } catch (e) {
      failed(e);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    if (current >= TOTAL_STEPS || !gateForward(current)) return;
    // Leaving Safety saves the agent first: knowledge entries attach to a saved row.
    if (current === 4 && (!saved || s.id === null) && !(await save(true))) return;
    showStep(current + 1);
  };

  const jump = async (target: number) => {
    if (target === 5 && s.id === null) {
      // Same rule as the Next button: Knowledge needs a saved row, so the earlier steps must pass and be saved.
      if (!gateForward(current) || !(await save(true))) return;
      return showStep(5);
    }
    if (canJump(target, current, furthest) === 'free' || gateForward(current)) showStep(target);
  };

  const finish = async () => {
    if (canSave && !saved && !(await save(false))) return;
    router.push('/ai-training');
  };

  const stepProps = { s, set, flash, disabled: !canSave || saving };
  const pane =
    current === 1 ? (
      <IdentityStep {...stepProps} />
    ) : current === 2 ? (
      <PersonaStep {...stepProps} />
    ) : current === 3 ? (
      <BrainStep {...stepProps} enabled={models.data ?? []} modelsLoaded={models.isSuccess} />
    ) : current === 4 ? (
      <SafetyStep {...stepProps} />
    ) : (
      <KnowledgeStep assistantId={s.id} canEdit={canKnowledge} />
    );

  return (
    <>
      {locked && <PlanPaywall />}
      <div className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex max-w-none items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/ai-training"
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
              <h1 className="truncate text-xl font-normal leading-tight">
                {editing ? t('titleEdit') : t('titleNew')}{' '}
                <span className="not-italic text-brand">{t('titleAccent')}</span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              data-testid="state-pill"
              role="status"
              className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] font-medium"
            >
              {saved ? t('stateSaved') : t('stateDraft')}
            </span>
            {canSave && (
              <button
                type="button"
                disabled={saving}
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
        <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
          <nav aria-label={t('stepper')} className="border-b border-border bg-muted/40 px-5 py-4">
            <ol className="flex items-center overflow-x-auto">
              {([1, 2, 3, 4, 5] as const).map((n) => {
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
                      onClick={() => void jump(n)}
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
                        {t(`steps.${STEP_KEYS[n - 1]}`)}
                      </span>
                    </button>
                    {n < TOTAL_STEPS && (
                      <span
                        className={cn(
                          'mx-2 h-[2px] min-w-4 flex-1 rounded',
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

          <div className="p-5">{pane}</div>

          <div className="flex items-center justify-between border-t border-border bg-muted/40 px-5 py-4">
            <button
              type="button"
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
            {current < TOTAL_STEPS ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void next()}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-60"
              >
                {saving && <Spinner />}
                {t('next')}
                <NextIcon className="size-3" />
              </button>
            ) : (
              <Button
                disabled={saving}
                onClick={() => void finish()}
                className="h-auto gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold"
              >
                {saving && <Spinner />}
                {t('finish')}
              </Button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
