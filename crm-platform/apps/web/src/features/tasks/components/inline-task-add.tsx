'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, Input, Select, Spinner, useToast } from '@crm/ui';
import { TASK_TITLE_MAX, type TaskPriority, type TaskResponse } from '@crm/contracts';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { invalidateTasks, useMembers } from '../api/hooks';
import { PRIORITIES } from '../api/schemas';
import { tasksApi, type TaskSource } from '../api/service';
import { presetDue, toLocalInput, type DuePreset } from '../lib/dates';
import { errorKind } from '../lib/errors';
import {
  inlineCreateBody,
  inlineDraft,
  optimisticAdd,
  pendingTask,
  validateInline,
  type InlineDraft,
  type InlineProblem,
} from '../lib/inline-tasks';
import { PlusIcon } from './icons';
import { useWorkspaceZone } from './parts';

const PRESETS: DuePreset[] = ['today', 'tomorrow', 'nextWeek'];

/**
 * "Add task" for a record, in the page itself (no dialog): a quiet row that opens into the task row, a title, a due date, who it is for
 * (me to begin with) and an optional priority. Enter saves, Escape closes the row. The task shows in the list the moment Enter is
 * pressed; if the server refuses, it leaves again and the typed title is put back with the reason. After a save the row stays open on a
 * fresh title so several tasks can follow one another.
 *
 * `focusSignal` changes each time something outside (the "Task" button of the contact's action bar) wants the row open and focused.
 */
export function InlineTaskAdd({
  source,
  label,
  focusSignal,
  onChanged,
}: {
  source: Exclude<TaskSource, { kind: 'all' }>;
  /** The record's name, for the contact chip on the pending row. */
  label?: string;
  focusSignal?: number;
  onChanged?: () => void;
}) {
  const t = useTranslations('tasks');
  const ti = useTranslations('tasks.inline');
  const tp = useTranslations('tasks.form.problems');
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = useSession();
  const zone = useWorkspaceZone();
  const members = useMembers();
  const id = useId();
  const title = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<InlineDraft>(() => inlineDraft(session.user.id, new Date()));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);

  // Something outside asked for the row (the action bar's "Task"): open it, focus the title and bring it into view.
  // Starts unseen, so a request that is already there when the row mounts (the Tasks tab just opened by the Task button) opens it.
  const [seenSignal, setSeenSignal] = useState<number | undefined>(undefined);
  if (focusSignal !== seenSignal) {
    setSeenSignal(focusSignal);
    if (focusSignal) setOpen(true);
  }
  useEffect(() => {
    if (focusSignal === undefined || focusSignal === 0) return;
    const frame = window.requestAnimationFrame(() => {
      title.current?.focus();
      root.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusSignal]);

  const problems = validateInline(draft);
  const shown = tried ? problems : {};
  const text = (p: InlineProblem | undefined) => (p ? tp(p) : undefined);
  const set = (patch: Partial<InlineDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const close = () => {
    setOpen(false);
    setTried(false);
    setFailure(null);
    setDraft(inlineDraft(session.user.id, new Date()));
  };

  function save() {
    setTried(true);
    setFailure(null);
    if (Object.keys(problems).length > 0) {
      if (problems.title) title.current?.focus();
      return;
    }
    const body = inlineCreateBody(draft, source);
    const people = members.data ?? [];
    const assignee = people.find((m) => m.id === draft.assigneeId);
    const me = { id: session.user.id, name: session.user.displayName ?? session.user.fullName };
    const now = new Date();
    const sent = draft;
    const pending = pendingTask(
      body,
      {
        assignee: assignee ? { id: assignee.id, name: assignee.fullName } : me,
        createdBy: me,
        contact: source.kind === 'contact' ? { id: source.id, name: label ?? null } : null,
      },
      now,
      zone,
    );
    const { rollback, confirm } = optimisticAdd(qc, source, pending);
    // The row is ready for the next one straight away; a failure puts the typed title back.
    setDraft((d) => ({ ...d, title: '' }));
    setTried(false);
    setBusy((n) => n + 1);
    tasksApi
      .create(body)
      .then((real: TaskResponse) => {
        confirm(real);
        void invalidateTasks(qc);
        toast(t('toast.created'), 'success');
        onChanged?.();
      })
      .catch((e: unknown) => {
        rollback();
        void invalidateTasks(qc);
        setDraft((d) => (d.title === '' ? { ...sent } : d));
        setFailure(errorKind(e) === 'assigneeInvalid' ? tp('assigneeInvalid') : ti('failed'));
        setOpen(true);
        title.current?.focus();
      })
      .finally(() => setBusy((n) => n - 1));
    title.current?.focus();
  }

  if (!open) {
    return (
      <div ref={root}>
        <button
          type="button"
          aria-expanded={false}
          onClick={() => {
            setOpen(true);
            window.requestAnimationFrame(() => title.current?.focus());
          }}
          className="flex h-10 w-full items-center gap-2 rounded-md border border-dashed border-border px-3 text-start text-sm text-muted-foreground outline-none transition hover:border-primary/50 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <PlusIcon className="size-4" />
          {ti('addTask')}
        </button>
      </div>
    );
  }

  const people = members.data ?? [];
  const known = people.some((m) => m.id === draft.assigneeId);

  return (
    <div ref={root}>
      <form
        aria-label={ti('rowLabel')}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => {
          // Escape closes the row only; it must not also close the drawer around it.
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
        className="space-y-2 rounded-md border border-primary/40 bg-background p-3 ring-1 ring-primary/20"
      >
        <div>
          <label htmlFor={`${id}-title`} className="sr-only">
            {ti('titleLabel')}
          </label>
          <Input
            ref={title}
            id={`${id}-title`}
            autoFocus
            value={draft.title}
            maxLength={TASK_TITLE_MAX}
            dir="auto"
            invalid={!!shown.title}
            placeholder={ti('titlePlaceholder')}
            aria-describedby={`${id}-hint`}
            onChange={(e) => {
              set({ title: e.target.value });
              if (failure) setFailure(null);
            }}
          />
          {shown.title && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {text(shown.title)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="datetime-local"
            aria-label={`${ti('due')} *`}
            aria-required
            value={draft.due}
            invalid={!!shown.due}
            onChange={(e) => set({ due: e.target.value })}
            className="w-auto min-w-44 flex-1"
          />
          <Select
            aria-label={ti('assignee')}
            value={draft.assigneeId}
            onChange={(e) => set({ assigneeId: e.target.value })}
            className="w-auto min-w-32 flex-1"
          >
            {!known && (
              <option value={draft.assigneeId}>
                {session.user.displayName ?? session.user.fullName}
              </option>
            )}
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === session.user.id ? t('form.me', { name: m.fullName }) : m.fullName}
              </option>
            ))}
          </Select>
          <Select
            aria-label={ti('priority')}
            value={draft.priority}
            onChange={(e) => set({ priority: e.target.value as TaskPriority })}
            className="w-auto min-w-28"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`form.priorities.${p}`)}
              </option>
            ))}
          </Select>
        </div>
        {shown.due && (
          <p role="alert" className="text-xs text-danger">
            {text(shown.due)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => set({ due: toLocalInput(presetDue(p, new Date())) })}
              className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t(`form.presets.${p}`)}
            </button>
          ))}
        </div>
        {failure && (
          <p role="alert" className="text-xs text-danger">
            {failure}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {ti('hint')}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={close}>
              {ti('cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={draft.title.trim() === ''}>
              {busy > 0 && <Spinner />}
              {ti('save')}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
