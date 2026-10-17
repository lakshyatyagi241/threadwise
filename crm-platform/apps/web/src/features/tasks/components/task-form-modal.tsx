'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Input, Modal, Select, Spinner, Textarea, useToast } from '@crm/ui';
import { TASK_NOTES_MAX, TASK_TITLE_MAX, type TaskResponse } from '@crm/contracts';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useMembers } from '../api/hooks';
import { PRIORITIES, type RecordRef } from '../api/schemas';
import { tasksApi } from '../api/service';
import { presetDue, toLocalInput, type DuePreset } from '../lib/dates';
import { errorKind, fieldErrors } from '../lib/errors';
import {
  createBody,
  draftOf,
  emptyDraft,
  patchBody,
  validateDraft,
  type TaskDraft,
} from '../lib/task-form';
import { RecordPicker } from './record-picker';
import { useErrorText } from './parts';
import { useTaskActions } from './use-task-actions';

export interface TaskFormModalProps {
  /** Present: edit this task. Absent: create. */
  task?: TaskResponse;
  /** Pre-links a new task (from a contact, a deal or a company). A company is shown, not editable here. */
  link?: { contact?: RecordRef; deal?: RecordRef; company?: RecordRef };
  /** A title typed elsewhere (the quick add on a contact or deal) to start the new task from. */
  initialTitle?: string;
  onClose: () => void;
  onSaved?: (task: TaskResponse) => void;
}

type FormField = 'title' | 'notes' | 'due' | 'assignee' | 'priority' | 'form';

/** "New task" and "Edit task" (TW-TASK-003/005). Mount it only while it is open: it starts from the task every time. */
export function TaskFormModal({ task, link, initialTitle, onClose, onSaved }: TaskFormModalProps) {
  const t = useTranslations('tasks.form');
  const toastText = useTranslations('tasks.toast');
  const { toast } = useToast();
  const session = useSession();
  const members = useMembers();
  const actions = useTaskActions();
  const errorText = useErrorText();
  const editing = task !== undefined;
  const [draft, setDraft] = useState<TaskDraft>(() =>
    task
      ? draftOf(task)
      : {
          ...emptyDraft(session.user.id),
          title: initialTitle ?? '',
          contactId: link?.contact?.id ?? '',
          dealId: link?.deal?.id ?? '',
          companyId: link?.company?.id ?? '',
        },
  );
  const [contact, setContact] = useState<RecordRef | null>(
    task?.contact
      ? { id: task.contact.id, label: task.contact.name ?? '' }
      : (link?.contact ?? null),
  );
  const [deal, setDeal] = useState<RecordRef | null>(
    task?.deal ? { id: task.deal.id, label: task.deal.title } : (link?.deal ?? null),
  );
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TaskDraft>(k: K, v: TaskDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  async function submit() {
    const problems = validateDraft(draft);
    if (Object.keys(problems).length > 0) {
      setErrors({
        title: problems.title && t(`problems.${problems.title}`),
        notes: problems.notes && t(`problems.${problems.notes}`),
        due: problems.due && t(`problems.${problems.due}`),
        priority: problems.priority && t(`problems.${problems.priority}`),
        assignee: problems.assignee && t(`problems.${problems.assignee}`),
      });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      // Raw calls, not the toasting actions: a failure stays inside the form.
      let saved: TaskResponse | null = null;
      if (task) {
        const patch = patchBody(task, draft);
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        saved = await tasksApi.update(task, patch);
      } else {
        saved = await tasksApi.create(createBody(draft));
      }
      actions.refresh(saved);
      // Reference flashes "Task created." after the form; the modal closes, so say it in a toast.
      toast(toastText(task ? 'saved' : 'created'), 'success');
      onSaved?.(saved);
      onClose();
    } catch (e) {
      const server = fieldErrors(e);
      const kind = errorKind(e);
      setErrors({
        title: server.title ? t('problems.titleRequired') : undefined,
        notes: server.notes ? t('problems.notesTooLong') : undefined,
        due: server.dueAt ? t('problems.dueInvalid') : undefined,
        assignee: kind === 'assigneeInvalid' ? t('problems.assigneeInvalid') : undefined,
        form:
          Object.keys(server).length === 0 && kind !== 'assigneeInvalid' ? errorText(e) : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const presets: DuePreset[] = ['today', 'tomorrow', 'nextWeek'];
  const people = members.data ?? [];
  const known = !draft.assigneeId || people.some((m) => m.id === draft.assigneeId);

  return (
    <Modal
      open
      size="md"
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={t('eyebrow')}
      title={editing ? t('editTitle') : t('newTitle')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="brand" onClick={() => void submit()} disabled={busy}>
            {busy && <Spinner />}
            {editing ? t('save') : t('create')}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        {errors.form && (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {errors.form}
          </p>
        )}
        <Field
          label={t('title')}
          htmlFor="task-title"
          error={errors.title}
          className="sm:col-span-2"
        >
          <Input
            id="task-title"
            autoFocus
            maxLength={TASK_TITLE_MAX}
            value={draft.title}
            invalid={!!errors.title}
            placeholder={t('titlePlaceholder')}
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>
        <Field label={`${t('priority')} *`} htmlFor="task-priority" error={errors.priority}>
          <Select
            id="task-priority"
            value={draft.priority}
            invalid={!!errors.priority}
            onChange={(e) => set('priority', e.target.value as TaskDraft['priority'])}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`priorities.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t('assignee')} *`} htmlFor="task-assignee" error={errors.assignee}>
          <Select
            id="task-assignee"
            value={draft.assigneeId}
            invalid={!!errors.assignee}
            onChange={(e) => set('assigneeId', e.target.value)}
          >
            {draft.assigneeId === '' && <option value="">{t('assigneePick')}</option>}
            {!known && task?.assignee && (
              <option value={task.assignee.id}>{task.assignee.name}</option>
            )}
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === session.user.id ? t('me', { name: m.fullName }) : m.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={`${t('due')} *`}
          htmlFor="task-due"
          error={errors.due}
          className="sm:col-span-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="task-due"
              type="datetime-local"
              value={draft.due}
              invalid={!!errors.due}
              className="w-auto min-w-52"
              required
              aria-required
              onChange={(e) => set('due', e.target.value)}
            />
            {presets.map((p) => (
              <Button
                key={p}
                size="sm"
                variant="secondary"
                onClick={() => set('due', toLocalInput(presetDue(p, new Date())))}
              >
                {t(`presets.${p}`)}
              </Button>
            ))}
          </div>
        </Field>
        <Field label={t('contact')} htmlFor="task-contact">
          <RecordPicker
            id="task-contact"
            kind="contact"
            value={contact}
            onChange={(r) => {
              setContact(r);
              set('contactId', r?.id ?? '');
            }}
          />
        </Field>
        <Field label={t('deal')} htmlFor="task-deal">
          <RecordPicker
            id="task-deal"
            kind="deal"
            value={deal}
            onChange={(r) => {
              setDeal(r);
              set('dealId', r?.id ?? '');
            }}
          />
        </Field>
        <Field
          label={t('notes')}
          htmlFor="task-notes"
          error={errors.notes}
          className="sm:col-span-2"
        >
          <Textarea
            id="task-notes"
            rows={3}
            maxLength={TASK_NOTES_MAX}
            value={draft.notes}
            invalid={!!errors.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </Field>
        {link?.company && (
          <p className="text-sm text-muted-foreground sm:col-span-2">
            {t('company')}:{' '}
            <span className="font-medium text-foreground" dir="auto">
              {link.company.label}
            </span>
          </p>
        )}
        <p className="text-xs text-muted-foreground sm:col-span-2">{t('reminderHint')}</p>
      </form>
    </Modal>
  );
}
