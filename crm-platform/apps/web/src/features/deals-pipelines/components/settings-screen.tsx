'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Switch,
  cn,
  useToast,
} from '@crm/ui';
import { invalidateDeals, KEYS, useDealSettings, useLostReasons, usePipelines } from '../api/hooks';
import { dealsApi } from '../api/service';
import type { LostReason, Pipeline, Stage, StageInput, StageKind } from '../api/schemas';
import { currencyChoices } from '../lib/money';
import {
  STAGE_COLORS,
  moveStage,
  needsReassign,
  probabilityFor,
  reassignTargets,
  validateStage,
} from '../lib/stage-editor';
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GearIcon,
  PlusIcon,
  TrashIcon,
} from './icons';
import { ErrorLine, useDealsCan, useErrorText } from './parts';
import { StageRow } from './stage-row';

/** `/deals/settings` (TW-DEAL-041/042/021): pipelines, their stages, and the auto-deal-from-orders switch. */
export function SettingsScreen() {
  const t = useTranslations('deals-pipelines.settings');
  const can = useDealsCan();
  const errorText = useErrorText();
  const { toast } = useToast();
  const qc = useQueryClient();
  const pipelines = usePipelines();
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const all = pipelines.data ?? [];
  const pipeline = all.find((p) => p.id === selectedId) ?? all.find((p) => p.isDefault) ?? all[0];
  const disabled = !can.editPipelines;

  const refresh = () =>
    Promise.all([invalidateDeals(qc), qc.invalidateQueries({ queryKey: KEYS.pipelines })]);

  /** Runs a write, then reloads the pipelines; a failure becomes a toast in our words. */
  async function run(fn: () => Promise<unknown>, ok?: string): Promise<boolean> {
    try {
      await fn();
      await refresh();
      if (ok) toast(ok, 'success');
      return true;
    } catch (e) {
      toast(`${t('errors.failed')} ${errorText(e)}`, 'danger');
      return false;
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-background p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground"
          >
            <GearIcon className="size-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/deals"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            <ArrowLeftIcon /> {t('back')}
          </Link>
          {can.createPipelines && (
            <Button variant="brand" className="h-11 px-5" onClick={() => setCreating(true)}>
              <PlusIcon /> {t('newPipeline')}
            </Button>
          )}
        </div>
      </header>

      {pipelines.isPending && (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      )}
      {pipelines.isError && (
        <ErrorLine error={pipelines.error} onRetry={() => void pipelines.refetch()} />
      )}
      {pipelines.isSuccess && all.length === 0 && (
        <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
      )}

      {pipeline && (
        <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
          <nav aria-label={t('pipelines')} className="space-y-2">
            {all.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-current={p.id === pipeline.id}
                onClick={() => setSelectedId(p.id)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2.5 text-start transition',
                  p.id === pipeline.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.isDefault && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase text-primary">
                      {t('default')}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {p.currency} · {t('stageCount', { count: p.stages.length })}
                </span>
              </button>
            ))}
          </nav>

          <div className="min-w-0 space-y-5">
            <PipelineEditor
              key={pipeline.id}
              pipeline={pipeline}
              others={all.filter((p) => p.id !== pipeline.id)}
              disabled={disabled}
              canDelete={can.deletePipelines}
              run={run}
            />
            <StagesEditor pipeline={pipeline} disabled={disabled} run={run} />
            <LostReasonsCard disabled={disabled} run={run} />
          </div>
        </div>
      )}

      {creating && (
        <NewPipelineModal
          onClose={() => setCreating(false)}
          onCreate={async (name, currency) => {
            const ok = await run(
              () => dealsApi.createPipeline({ name, currency }),
              t('pipelineCreated'),
            );
            if (ok) setCreating(false);
          }}
        />
      )}
    </div>
  );
}

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

function PipelineEditor({
  pipeline,
  others,
  disabled,
  canDelete,
  run,
}: {
  pipeline: Pipeline;
  others: readonly Pipeline[];
  disabled: boolean;
  canDelete: boolean;
  run: Run;
}) {
  const t = useTranslations('deals-pipelines.settings');
  const [name, setName] = useState(pipeline.name);
  const [confirm, setConfirm] = useState(false);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const nameProblem = name.trim() === '';
  const needsTarget = pipeline.dealCount > 0;
  const blockedReason = pipeline.isDefault ? t('defaultProtected') : null;

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-background p-5"
      aria-labelledby="pl-edit"
    >
      <h2 id="pl-edit" className="text-base font-semibold">
        {t('pipelineDetails')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t('pipelineName')}
          htmlFor="pl-name"
          error={nameProblem ? t('nameRequired') : undefined}
        >
          <Input
            id="pl-name"
            value={name}
            maxLength={120}
            disabled={disabled}
            invalid={nameProblem}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const v = name.trim();
              if (v && v !== pipeline.name)
                void run(() => dealsApi.updatePipeline(pipeline, { name: v }), t('saved'));
              else if (!v) setName(pipeline.name);
            }}
          />
        </Field>
        <Field label={t('currency')} htmlFor="pl-currency" hint={t('currencyHint')}>
          <Select
            id="pl-currency"
            value={pipeline.currency}
            disabled={disabled}
            onChange={(e) =>
              void run(
                () => dealsApi.updatePipeline(pipeline, { currency: e.target.value }),
                t('saved'),
              )
            }
          >
            {currencyChoices(pipeline.currency).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!pipeline.isDefault && (
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() =>
              void run(
                () => dealsApi.updatePipeline(pipeline, { isDefault: true }),
                t('madeDefault'),
              )
            }
          >
            {t('makeDefault')}
          </Button>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            className="ms-auto text-danger"
            disabled={disabled || blockedReason !== null}
            title={blockedReason ?? undefined}
            onClick={() => setConfirm(true)}
          >
            {t('deletePipeline')}
          </Button>
        )}
      </div>
      {blockedReason && canDelete && (
        <p className="text-xs text-muted-foreground">{blockedReason}</p>
      )}
      {confirm && (
        <Modal
          open
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
          title={t('deletePipelineTitle')}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={busy || (needsTarget && !target)}
                onClick={() => {
                  setBusy(true);
                  void run(
                    () => dealsApi.deletePipeline(pipeline.id, needsTarget ? target : undefined),
                    t('pipelineDeleted'),
                  ).finally(() => {
                    setBusy(false);
                    setConfirm(false);
                  });
                }}
              >
                {busy && <Spinner />}
                {t('deletePipeline')}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {needsTarget
                ? t('deletePipelineMoveMessage', { name: pipeline.name, count: pipeline.dealCount })
                : t('deletePipelineMessage', { name: pipeline.name })}
            </p>
            {needsTarget && (
              <Field label={t('moveDealsToPipeline')} htmlFor="move-pipeline">
                <Select
                  id="move-pipeline"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">{t('choosePipeline')}</option>
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

function StagesEditor({
  pipeline,
  disabled,
  run,
}: {
  pipeline: Pipeline;
  disabled: boolean;
  run: Run;
}) {
  const t = useTranslations('deals-pipelines.settings');
  const [toDelete, setToDelete] = useState<Stage | null>(null);
  const stages = pipeline.stages;

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-background p-5"
      aria-labelledby="st-edit"
    >
      <div>
        <h2 id="st-edit" className="text-base font-semibold">
          {t('stages')}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('stagesHint')}</p>
      </div>
      <ol className="space-y-2">
        {stages.map((s, i) => (
          <StageRow
            key={s.id}
            stage={s}
            siblings={stages}
            index={i}
            count={stages.length}
            disabled={disabled}
            onSave={(stage, patch) =>
              void run(() => dealsApi.updateStage(stage, patch), t('saved'))
            }
            onMove={(from, to) =>
              void run(() =>
                dealsApi.reorderStages(
                  pipeline.id,
                  moveStage(stages, from, to).map((x) => x.id),
                ),
              )
            }
            onDelete={setToDelete}
          />
        ))}
      </ol>
      {!disabled && <AddStage pipeline={pipeline} run={run} />}
      {toDelete && (
        <DeleteStageDialog
          stage={toDelete}
          others={reassignTargets(stages, toDelete.id)}
          onClose={() => setToDelete(null)}
          onConfirm={async (moveTo) => {
            const ok = await run(
              () => dealsApi.deleteStage(toDelete.id, moveTo),
              t('stageDeleted'),
            );
            if (ok) setToDelete(null);
          }}
        />
      )}
    </section>
  );
}

function AddStage({ pipeline, run }: { pipeline: Pipeline; run: Run }) {
  const t = useTranslations('deals-pipelines.settings');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<StageKind>('open');
  const [probability, setProbability] = useState(50);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function add() {
    const input: StageInput = {
      name: name.trim(),
      kind,
      probability: probabilityFor(kind, probability),
      color: STAGE_COLORS[pipeline.stages.length % STAGE_COLORS.length]!,
    };
    const found = validateStage(input, pipeline.stages);
    if (found.length > 0) {
      setProblem(t(`problems.${found[0]!}`));
      return;
    }
    setProblem(null);
    setBusy(true);
    const ok = await run(() => dealsApi.createStage(pipeline.id, input), t('stageAdded'));
    setBusy(false);
    if (ok) {
      setName('');
      setKind('open');
    }
  }

  return (
    <form
      className="rounded-lg border border-dashed border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('newStage')} htmlFor="new-stage" className="min-w-48 flex-1">
          <Input
            id="new-stage"
            value={name}
            maxLength={120}
            placeholder={t('newStagePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t('kind')} htmlFor="new-kind">
          <Select
            id="new-kind"
            value={kind}
            className="w-auto min-w-28"
            onChange={(e) => setKind(e.target.value as StageKind)}
          >
            {(['open', 'won', 'lost'] as const).map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('probability')} htmlFor="new-prob">
          <Input
            id="new-prob"
            type="number"
            min={0}
            max={100}
            className="w-20"
            disabled={kind !== 'open'}
            value={kind === 'open' ? probability : probabilityFor(kind, 0)}
            onChange={(e) => setProbability(Number(e.target.value))}
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner /> : <PlusIcon />} {t('addStage')}
        </Button>
      </div>
      {problem && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {problem}
        </p>
      )}
    </form>
  );
}

function DeleteStageDialog({
  stage,
  others,
  onClose,
  onConfirm,
}: {
  stage: Stage;
  others: readonly Stage[];
  onClose: () => void;
  onConfirm: (moveDealsTo?: string) => Promise<void>;
}) {
  const t = useTranslations('deals-pipelines.settings');
  const reassign = needsReassign(stage);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = others.length === 0 || (reassign && !target);

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t('deleteStageTitle', { name: stage.name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={busy || blocked}
            onClick={() => {
              setBusy(true);
              void onConfirm(reassign ? target : undefined).finally(() => setBusy(false));
            }}
          >
            {busy && <Spinner />}
            {t('deleteStageConfirm')}
          </Button>
        </>
      }
    >
      {others.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('lastStage')}</p>
      ) : reassign ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('reassignMessage', { count: stage.dealCount })}
          </p>
          <Field label={t('moveDealsTo')} htmlFor="reassign-to">
            <Select id="reassign-to" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t('chooseStage')}</option>
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('deleteStageMessage')}</p>
      )}
    </Modal>
  );
}

function NewPipelineModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, currency: string) => Promise<void>;
}) {
  const t = useTranslations('deals-pipelines.settings');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const invalid = name.trim() === '';

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t('newPipeline')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            variant="brand"
            disabled={busy}
            onClick={() => {
              setTouched(true);
              if (invalid) return;
              setBusy(true);
              void onCreate(name.trim(), currency).finally(() => setBusy(false));
            }}
          >
            {busy && <Spinner />}
            {t('create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={t('pipelineName')}
          htmlFor="np-name"
          error={touched && invalid ? t('nameRequired') : undefined}
        >
          <Input
            id="np-name"
            autoFocus
            value={name}
            maxLength={120}
            invalid={touched && invalid}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t('currency')} htmlFor="np-currency">
          <Select id="np-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencyChoices('USD').map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-muted-foreground">{t('newPipelineHint')}</p>
      </div>
    </Modal>
  );
}

/** The lost-reason catalogue and whether a reason is required to close a deal as lost (TW-DEAL-043, D-08). */
function LostReasonsCard({ disabled, run }: { disabled: boolean; run: Run }) {
  const t = useTranslations('deals-pipelines.settings');
  const settings = useDealSettings();
  const reasons = useLostReasons(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = reasons.data ?? [];

  async function add() {
    const v = name.trim();
    if (!v || busy) return;
    setBusy(true);
    const ok = await run(() => dealsApi.createLostReason(v), t('reasonAdded'));
    setBusy(false);
    if (ok) setName('');
  }

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-background p-5"
      aria-labelledby="lr-h"
    >
      <div>
        <h2 id="lr-h" className="text-base font-semibold">
          {t('lostReasons')}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('lostReasonsHint')}</p>
      </div>

      {settings.isError ? (
        <ErrorLine error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <div className="flex items-start gap-3">
          <Switch
            id="lost-required"
            checked={settings.data?.lostReasonRequired ?? true}
            disabled={disabled || settings.isPending}
            label={t('lostRequired')}
            onCheckedChange={(next) => void run(() => dealsApi.saveSettings(next), t('saved'))}
          />
          <label htmlFor="lost-required" className="text-sm">
            <span className="block font-medium">{t('lostRequired')}</span>
            <span className="text-muted-foreground">{t('lostRequiredHint')}</span>
          </label>
        </div>
      )}

      {reasons.isError && (
        <ErrorLine error={reasons.error} onRetry={() => void reasons.refetch()} />
      )}
      {reasons.isPending && <Spinner />}
      {reasons.data && rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
          {t('noReasons')}
        </p>
      )}
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <ReasonRow key={r.id} reason={r} index={i} rows={rows} disabled={disabled} run={run} />
        ))}
      </ul>

      {!disabled && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field label={t('newReason')} htmlFor="new-reason" className="min-w-48 flex-1">
            <Input
              id="new-reason"
              value={name}
              maxLength={191}
              placeholder={t('newReasonPlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy || name.trim() === ''}>
            {busy ? <Spinner /> : <PlusIcon />} {t('addReason')}
          </Button>
        </form>
      )}
    </section>
  );
}

function ReasonRow({
  reason,
  index,
  rows,
  disabled,
  run,
}: {
  reason: LostReason;
  index: number;
  rows: readonly LostReason[];
  disabled: boolean;
  run: Run;
}) {
  const t = useTranslations('deals-pipelines.settings');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const swap = (to: number) => {
    const ids = rows.map((x) => x.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(to, 0, moved!);
    void run(() => dealsApi.reorderLostReasons(ids));
  };
  const arrow =
    'flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30';
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
      <div className="flex flex-col">
        <button
          type="button"
          disabled={disabled || index === 0}
          aria-label={t('moveUp', { name: reason.name })}
          onClick={() => swap(index - 1)}
          className={arrow}
        >
          <ChevronUpIcon className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={disabled || index === rows.length - 1}
          aria-label={t('moveDown', { name: reason.name })}
          onClick={() => swap(index + 1)}
          className={arrow}
        >
          <ChevronDownIcon className="size-3.5" />
        </button>
      </div>
      <Input
        key={reason.name}
        defaultValue={reason.name}
        maxLength={191}
        disabled={disabled}
        aria-label={t('reasonName')}
        className="min-w-40 flex-1"
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== reason.name)
            void run(() => dealsApi.updateLostReason(reason, { name: v }), t('saved'));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <span className="text-xs tabular-nums text-muted-foreground">
        {t('dealCount', { count: reason.dealCount })}
      </span>
      <Switch
        checked={reason.isActive}
        disabled={disabled}
        label={t('reasonActive', { name: reason.name })}
        onCheckedChange={(next) =>
          void run(() => dealsApi.updateLostReason(reason, { isActive: next }), t('saved'))
        }
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={t('deleteReason', { name: reason.name })}
        onClick={() => setConfirm(true)}
        className="flex size-9 items-center justify-center rounded-md text-danger hover:bg-danger/10 disabled:opacity-50"
      >
        <TrashIcon />
      </button>
      <ConfirmDialog
        open={confirm}
        title={t('deleteReasonTitle', { name: reason.name })}
        message={t('deleteReasonMessage')}
        confirmLabel={t('deleteReasonConfirm')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => {
          setBusy(true);
          void run(() => dealsApi.deleteLostReason(reason.id), t('reasonDeleted')).finally(() => {
            setBusy(false);
            setConfirm(false);
          });
        }}
        onClose={() => setConfirm(false)}
      />
    </li>
  );
}
