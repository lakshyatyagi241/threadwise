'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, ConfirmDialog, Field, Input, Select, Textarea, cn } from '@crm/ui';
import { TASK_NOTES_MAX, TASK_TITLE_MAX, type TaskResponse } from '@crm/contracts';
import { useMembers, useTask } from '../api/hooks';
import { PRIORITIES, type RecordRef } from '../api/schemas';
import { fromLocalInput, presetDue, toLocalInput, type DuePreset } from '../lib/dates';
import { formatDateTime } from '../lib/format';
import { Drawer } from './drawer';
import { CheckIcon, PencilIcon, TrashIcon } from './icons';
import {
  Avatar,
  CompleteCheck,
  ErrorLine,
  PriorityChip,
  RecordPill,
  useNow,
  useWorkspaceZone,
  DueText,
} from './parts';
import {
  OptionSelect,
  useActivitySettings,
  useCompletionOffText,
} from '@/features/sales-activities';
import { CompleteWithOutcome, OutcomeSelect } from './outcome-select';
import { RecordPicker } from './record-picker';
import { useTaskActions } from './use-task-actions';

export interface TaskDrawerProps {
  taskId: string;
  /** The row's copy, shown while the full record loads. */
  seed?: TaskResponse;
  canUpdate: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (task: TaskResponse) => void;
  onDeleted: (id: string) => void;
}

/** The detail panel: fields that save when you leave them, the notes, the linked records and what happened to the task. */
export function TaskDrawer(p: TaskDrawerProps) {
  const t = useTranslations('tasks.drawer');
  const detail = useTask(p.taskId);
  const task = detail.data ?? p.seed;
  return (
    <Drawer onClose={p.onClose} title={task?.title ?? t('loading')} closeLabel={t('close')}>
      {!task && detail.isPending && (
        <div className="space-y-3 p-6" aria-busy="true" aria-label={t('loading')}>
          <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
          <div className="h-40 animate-pulse rounded bg-muted" />
        </div>
      )}
      {!task && detail.isError && (
        <div className="p-6">
          <ErrorLine error={detail.error} onRetry={() => void detail.refetch()} />
        </div>
      )}
      {task && <DrawerBody {...p} task={task} />}
    </Drawer>
  );
}

function DrawerBody({
  task,
  canUpdate,
  canDelete,
  onEdit,
  onDeleted,
}: TaskDrawerProps & { task: TaskResponse }) {
  const t = useTranslations('tasks.drawer');
  const tf = useTranslations('tasks.form');
  const locale = useLocale();
  const now = useNow();
  const zone = useWorkspaceZone();
  const members = useMembers();
  const actions = useTaskActions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [dueError, setDueError] = useState(false);
  const completeOff = useCompletionOffText();
  const taskSettings = useActivitySettings('task');
  const done = task.status === 'done';
  const people = members.data ?? [];

  const contactRef: RecordRef | null = task.contact
    ? { id: task.contact.id, label: task.contact.name ?? '' }
    : null;
  const dealRef: RecordRef | null = task.deal ? { id: task.deal.id, label: task.deal.title } : null;

  async function remove() {
    setBusy(true);
    const ok = await actions.remove(task.id);
    if (ok) onDeleted(task.id);
    else {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <div className="space-y-4 border-b border-border p-5 pe-14">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('eyebrow')}
        </div>
        <div className="flex items-start gap-3">
          <CompleteCheck
            className="mt-3"
            done={done}
            title={task.title}
            disabled={!canUpdate}
            onToggle={() => void actions.toggle(task)}
          />
          <Field
            label={<span className="sr-only">{t('name')}</span>}
            htmlFor="task-drawer-title"
            error={titleError ? t('titleRequired') : undefined}
            className="min-w-0 flex-1"
          >
            <Input
              key={`${task.title}:${task.rowVersion}`}
              id="task-drawer-title"
              defaultValue={task.title}
              maxLength={TASK_TITLE_MAX}
              readOnly={!canUpdate}
              invalid={titleError}
              dir="auto"
              className={cn(
                'h-11 text-base font-semibold',
                done && 'text-muted-foreground line-through',
              )}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v === task.title) return setTitleError(false);
                if (v === '') return setTitleError(true);
                setTitleError(false);
                void actions.save(task, { title: v });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              done ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
            )}
          >
            {done ? t('statusDone') : t('statusOpen')}
          </span>
          <PriorityChip priority={task.priority} />
          {task.outcome && (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
              {t('outcomeChip', { name: task.outcome.name })}
            </span>
          )}
          <DueText task={task} now={now} zone={zone} className="text-sm" />
        </div>
        {canUpdate && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={done ? 'secondary' : 'brand'}
              disabled={!done && !taskSettings.allowComplete}
              title={!done && !taskSettings.allowComplete ? completeOff : undefined}
              onClick={() => void actions.toggle(task)}
            >
              <CheckIcon /> {done ? t('reopen') : t('complete')}
            </Button>
            {!done && taskSettings.allowComplete && (
              <CompleteWithOutcome onComplete={(id) => void actions.toggle(task, id)} />
            )}
            <Button variant="secondary" onClick={() => onEdit(task)}>
              <PencilIcon /> {t('edit')}
            </Button>
            {canDelete && (
              <Button
                variant="ghost"
                className="ms-auto text-danger"
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon /> {t('delete')}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-6 p-5">
        <section aria-labelledby="task-drawer-details" className="space-y-3">
          <h3 id="task-drawer-details" className="text-sm font-semibold">
            {t('details')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tf('priority')} htmlFor="task-drawer-priority">
              <Select
                id="task-drawer-priority"
                disabled={!canUpdate}
                value={task.priority}
                onChange={(e) =>
                  void actions.save(task, { priority: e.target.value as TaskResponse['priority'] })
                }
              >
                {PRIORITIES.map((x) => (
                  <option key={x} value={x}>
                    {tf(`priorities.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tf('assignee')} htmlFor="task-drawer-assignee">
              <Select
                id="task-drawer-assignee"
                disabled={!canUpdate}
                value={task.assignee?.id ?? ''}
                onChange={(e) => void actions.save(task, { assigneeId: e.target.value || null })}
              >
                <option value="">{tf('unassigned')}</option>
                {task.assignee && !people.some((m) => m.id === task.assignee?.id) && (
                  <option value={task.assignee.id}>{task.assignee.name}</option>
                )}
                {people.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <OutcomeSelect
              id="task-drawer-outcome"
              label={tf('outcome')}
              disabled={!canUpdate}
              value={task.outcome?.id ?? ''}
              current={task.outcome}
              onChange={(v) => void actions.save(task, { outcomeId: v || null })}
            />
            <OptionSelect
              activity="task"
              kind="type"
              id="task-drawer-type"
              disabled={!canUpdate}
              value={task.taskType?.id ?? ''}
              current={task.taskType}
              onChange={(id) => void actions.save(task, { taskTypeId: id || null })}
            />
            <Field
              label={tf('due')}
              htmlFor="task-drawer-due"
              error={dueError ? tf('problems.dueInvalid') : undefined}
              className="sm:col-span-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  key={`${task.dueAt}:${task.rowVersion}`}
                  id="task-drawer-due"
                  type="datetime-local"
                  defaultValue={toLocalInput(task.dueAt)}
                  readOnly={!canUpdate}
                  invalid={dueError}
                  className="w-auto min-w-52"
                  onBlur={(e) => {
                    const v = e.target.value;
                    const iso = fromLocalInput(v);
                    if (v !== '' && iso === null) return setDueError(true);
                    setDueError(false);
                    if (
                      iso !== task.dueAt &&
                      !(iso && task.dueAt && Date.parse(iso) === Date.parse(task.dueAt))
                    ) {
                      void actions.save(task, { dueAt: iso });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
                {canUpdate &&
                  (['today', 'tomorrow', 'nextWeek'] as DuePreset[]).map((preset) => (
                    <Button
                      key={preset}
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void actions.save(task, { dueAt: presetDue(preset, new Date()) })
                      }
                    >
                      {tf(`presets.${preset}`)}
                    </Button>
                  ))}
                {canUpdate && task.dueAt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void actions.save(task, { dueAt: null })}
                  >
                    {tf('clearDue')}
                  </Button>
                )}
              </div>
            </Field>
          </div>
        </section>

        <section className="space-y-2">
          <h3 id="task-drawer-notes" className="text-sm font-semibold">
            {t('notes')}
          </h3>
          <Textarea
            key={`${task.notes ?? ''}:${task.rowVersion}`}
            aria-labelledby="task-drawer-notes"
            rows={4}
            maxLength={TASK_NOTES_MAX}
            readOnly={!canUpdate}
            dir="auto"
            defaultValue={task.notes ?? ''}
            placeholder={canUpdate ? t('notesPlaceholder') : undefined}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (task.notes ?? '').trim()) void actions.save(task, { notes: v || null });
            }}
          />
        </section>

        <section aria-labelledby="task-drawer-links" className="space-y-3">
          <h3 id="task-drawer-links" className="text-sm font-semibold">
            {t('linked')}
          </h3>
          <Field label={tf('contact')} htmlFor="task-drawer-contact">
            <RecordPicker
              id="task-drawer-contact"
              kind="contact"
              value={contactRef}
              disabled={!canUpdate}
              onChange={(r) => void actions.save(task, { contactId: r?.id ?? null })}
            />
          </Field>
          <Field label={tf('deal')} htmlFor="task-drawer-deal">
            <RecordPicker
              id="task-drawer-deal"
              kind="deal"
              value={dealRef}
              disabled={!canUpdate}
              onChange={(r) => void actions.save(task, { dealId: r?.id ?? null })}
            />
          </Field>
          {task.company && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {t('company')}:{' '}
              <span className="font-medium text-foreground">{task.company.name}</span>
            </p>
          )}
          {!task.contact && !task.deal && !task.company && (
            <p className="text-xs text-muted-foreground">{t('noLinks')}</p>
          )}
          {(task.contact || task.deal) && (
            <div className="flex flex-wrap gap-2">
              {task.contact && (
                <RecordPill kind="contact" id={task.contact.id} label={task.contact.name} />
              )}
              {task.deal && <RecordPill kind="deal" id={task.deal.id} label={task.deal.title} />}
            </div>
          )}
        </section>

        <section
          aria-labelledby="task-drawer-activity"
          className="space-y-3 border-t border-border pt-5"
        >
          <h3 id="task-drawer-activity" className="text-sm font-semibold">
            {t('activity')}
          </h3>
          <ol className="relative space-y-4 ps-6 before:absolute before:inset-y-1 before:start-[9px] before:w-px before:bg-border">
            {activityOf(task).map((a) => (
              <li key={a.key} className="relative">
                <span className="absolute -start-6 top-0.5 size-[18px] rounded-full border border-border bg-background" />
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="flex items-center gap-1.5 text-sm">
                    {a.person && <Avatar name={a.person} className="size-5 text-[9px]" />}
                    {t(`events.${a.key}`, { name: a.person ?? '' })}
                  </span>
                  <time dateTime={a.at} className="font-mono text-[11px] text-muted-foreground">
                    {formatDateTime(a.at, locale, zone)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t('deleteTitle')}
        message={t('deleteMessage', { title: task.title })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}

type EventKey = 'created' | 'createdBy' | 'reminded' | 'completed';

/** What happened to the task, newest last: derived from the timestamps the task carries (the API has no event log yet). */
function activityOf(
  task: TaskResponse,
): Array<{ key: EventKey; at: string; person: string | null }> {
  const out: Array<{ key: EventKey; at: string; person: string | null }> = [
    task.createdBy
      ? { key: 'createdBy', at: task.createdAt, person: task.createdBy.name }
      : { key: 'created', at: task.createdAt, person: null },
  ];
  if (task.remindedAt) out.push({ key: 'reminded', at: task.remindedAt, person: null });
  if (task.doneAt) out.push({ key: 'completed', at: task.doneAt, person: null });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
