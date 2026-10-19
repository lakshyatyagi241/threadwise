'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog, Button, Field, Input, Spinner, Switch, useToast } from '@crm/ui';
import { TASK_OUTCOME_NAME_MAX, type TaskOutcomeResponse } from '@crm/contracts';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { invalidateTaskOutcomes, useTaskOutcomes } from '../api/hooks';
import { taskOutcomesApi } from '../api/service';
import { errorKind } from '../lib/errors';
import { moveItem, validateOutcomeName } from '../lib/outcomes';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, TasksIcon, TrashIcon } from './icons';
import { ErrorLine, useErrorText } from './parts';

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

/**
 * `/tasks/outcomes` (Settings > Task outcomes): the workspace's list of results a person picks when completing or logging a task. Add,
 * rename, hide (it stays on the tasks that have it), reorder and delete (refused while a task uses it). Anyone who can read tasks sees
 * the list; changing it needs `settings.task_outcomes.manage`.
 */
export function OutcomesScreen() {
  const t = useTranslations('tasks.outcomes');
  const { permissions } = useSession();
  const canManage = 'settings.task_outcomes.manage' in permissions;
  const errorText = useErrorText();
  const { toast } = useToast();
  const qc = useQueryClient();
  const outcomes = useTaskOutcomes(false);
  const rows = outcomes.data ?? [];
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);

  /** Runs a write, then reloads the list; a failure becomes a toast in our words (a 409 on a stale row says reload). */
  const run: Run = async (fn, ok) => {
    try {
      await fn();
      await invalidateTaskOutcomes(qc);
      if (ok) toast(ok, 'success');
      return true;
    } catch (e) {
      toast(`${t('failed')} ${errorKind(e) === 'conflict' ? t('conflict') : errorText(e)}`, 'danger');
      void invalidateTaskOutcomes(qc);
      return false;
    }
  };

  async function add() {
    const problem = validateOutcomeName(name, TASK_OUTCOME_NAME_MAX);
    if (problem) return setNameError(t(`problems.${problem}`));
    setNameError(undefined);
    setAdding(true);
    try {
      await taskOutcomesApi.create({ name: name.trim() });
      await invalidateTaskOutcomes(qc);
      toast(t('added'), 'success');
      setName('');
    } catch (e) {
      // A name another outcome has stays in the box with the reason beside it; anything else is a toast.
      if (errorKind(e) === 'outcomeNameTaken') setNameError(errorText(e));
      else toast(`${t('failed')} ${errorText(e)}`, 'danger');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-background p-4 sm:p-5">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground"
        >
          <TasksIcon className="size-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </header>

      <section
        className="space-y-4 rounded-xl border border-border bg-background p-5"
        aria-labelledby="task-outcomes-h"
      >
        <div>
          <h2 id="task-outcomes-h" className="text-base font-semibold">
            {t('listTitle')}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('listHint')}</p>
        </div>

        {outcomes.isPending && (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        )}
        {outcomes.isError && (
          <ErrorLine error={outcomes.error} onRetry={() => void outcomes.refetch()} />
        )}
        {outcomes.data && rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            {t('empty')}
          </p>
        )}
        <ul className="space-y-2" aria-label={t('listTitle')}>
          {rows.map((o, i) => (
            <OutcomeRow key={o.id} outcome={o} index={i} rows={rows} disabled={!canManage} run={run} />
          ))}
        </ul>

        {canManage ? (
          <form
            className="flex flex-wrap items-start gap-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Field
              label={t('newName')}
              htmlFor="new-outcome"
              error={nameError}
              className="min-w-48 flex-1"
            >
              <Input
                id="new-outcome"
                value={name}
                maxLength={TASK_OUTCOME_NAME_MAX}
                invalid={!!nameError}
                placeholder={t('newNamePlaceholder')}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(undefined);
                }}
              />
            </Field>
            <Button type="submit" className="mt-6" disabled={adding}>
              {adding ? <Spinner /> : <PlusIcon />} {t('add')}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">{t('readOnly')}</p>
        )}
      </section>
    </div>
  );
}

function OutcomeRow({
  outcome,
  index,
  rows,
  disabled,
  run,
}: {
  outcome: TaskOutcomeResponse;
  index: number;
  rows: readonly TaskOutcomeResponse[];
  disabled: boolean;
  run: Run;
}) {
  const t = useTranslations('tasks.outcomes');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const move = (to: number) =>
    void run(() =>
      taskOutcomesApi.reorder(moveItem(rows, index, to).map((x) => x.id)),
    );
  const arrow =
    'flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30';
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
      <div className="flex flex-col">
        <button
          type="button"
          disabled={disabled || index === 0}
          aria-label={t('moveUp', { name: outcome.name })}
          onClick={() => move(index - 1)}
          className={arrow}
        >
          <ChevronUpIcon className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={disabled || index === rows.length - 1}
          aria-label={t('moveDown', { name: outcome.name })}
          onClick={() => move(index + 1)}
          className={arrow}
        >
          <ChevronDownIcon className="size-3.5" />
        </button>
      </div>
      <div className="min-w-40 flex-1">
        <Input
          key={`${outcome.name}:${outcome.rowVersion}`}
          defaultValue={outcome.name}
          maxLength={TASK_OUTCOME_NAME_MAX}
          disabled={disabled}
          invalid={!!problem}
          aria-label={t('nameLabel')}
          dir="auto"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v === outcome.name) return setProblem(undefined);
            const bad = validateOutcomeName(v, TASK_OUTCOME_NAME_MAX);
            if (bad) {
              e.target.value = outcome.name;
              return setProblem(t(`problems.${bad}`));
            }
            setProblem(undefined);
            void run(() => taskOutcomesApi.update(outcome, { name: v }), t('saved')).then((ok) => {
              if (!ok) e.target.value = outcome.name;
            });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {problem && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {problem}
          </p>
        )}
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {t('taskCount', { count: outcome.taskCount })}
      </span>
      <Switch
        checked={outcome.isActive}
        disabled={disabled}
        label={t('shownLabel', { name: outcome.name })}
        onCheckedChange={(next) =>
          void run(() => taskOutcomesApi.update(outcome, { isActive: next }), t('saved'))
        }
      />
      <span className="w-14 text-xs text-muted-foreground">
        {outcome.isActive ? t('shown') : t('hidden')}
      </span>
      <button
        type="button"
        disabled={disabled || outcome.taskCount > 0}
        aria-label={t('deleteNamed', { name: outcome.name })}
        title={outcome.taskCount > 0 ? t('deleteInUse', { count: outcome.taskCount }) : undefined}
        onClick={() => setConfirm(true)}
        className="flex size-9 items-center justify-center rounded-md text-danger hover:bg-danger/10 disabled:opacity-50"
      >
        <TrashIcon />
      </button>
      <ConfirmDialog
        open={confirm}
        title={t('deleteTitle', { name: outcome.name })}
        message={t('deleteMessage')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => {
          setBusy(true);
          void run(() => taskOutcomesApi.remove(outcome.id), t('deleted')).finally(() => {
            setBusy(false);
            setConfirm(false);
          });
        }}
        onClose={() => setConfirm(false)}
      />
    </li>
  );
}
