'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Select, Spinner, cn } from '@crm/ui';
import { TASK_TITLE_MAX, type TaskPriority } from '@crm/contracts';
import { PRIORITIES } from '../api/schemas';
import { fromLocalInput } from '../lib/dates';
import { OptionsIcon, PlusIcon } from './icons';

export interface QuickAddValue {
  title: string;
  priority: TaskPriority;
  dueAt: string | null;
}

/**
 * The quick add row above the table: type a title, press Enter. Priority and due are optional; the task goes to the
 * signed-in person (the screen decides the rest). Stays in place after adding so several tasks can be entered in a row.
 *
 * On a phone the row is one line (the title, an options toggle and an icon-only add); priority and due open on a second
 * line from the toggle. From `sm` up everything sits in the one row, as before.
 */
export function QuickAdd({
  onAdd,
  disabled,
  compact,
}: {
  onAdd: (value: QuickAddValue) => Promise<boolean>;
  disabled?: boolean;
  /** One line: just the title and the button (the contact and deal panels). */
  compact?: boolean;
}) {
  const t = useTranslations('tasks.quick');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const [more, setMore] = useState(false);

  async function submit() {
    if (busy) return;
    if (title.trim() === '') {
      setProblem(true);
      return;
    }
    setProblem(false);
    setBusy(true);
    const ok = await onAdd({ title: title.trim(), priority, dueAt: fromLocalInput(due) });
    setBusy(false);
    if (ok) {
      setTitle('');
      setDue('');
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-wrap items-center gap-2"
      aria-label={t('label')}
      noValidate
    >
      <Input
        value={title}
        disabled={disabled}
        maxLength={TASK_TITLE_MAX}
        invalid={problem}
        placeholder={t('placeholder')}
        aria-label={t('placeholder')}
        aria-describedby={problem ? 'quick-add-problem' : undefined}
        onChange={(e) => {
          setTitle(e.target.value);
          if (problem) setProblem(false);
        }}
        className="min-w-0 flex-1 sm:min-w-48"
      />
      {!compact && (
        <>
          <Button
            variant="secondary"
            aria-label={t('options')}
            title={t('options')}
            aria-expanded={more}
            aria-controls="quick-add-options"
            onClick={() => setMore((v) => !v)}
            className={cn('px-2.5 sm:hidden', more && 'bg-muted')}
          >
            <OptionsIcon />
          </Button>
          <div
            id="quick-add-options"
            className={cn(
              'order-last basis-full flex-wrap items-center gap-2',
              more ? 'flex' : 'hidden',
              'sm:order-none sm:contents',
            )}
          >
            <Select
              aria-label={t('priority')}
              value={priority}
              disabled={disabled}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="w-auto min-w-28"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priorities.${p}`)}
                </option>
              ))}
            </Select>
            <Input
              type="datetime-local"
              aria-label={t('due')}
              value={due}
              disabled={disabled}
              onChange={(e) => setDue(e.target.value)}
              className="w-auto min-w-48"
            />
          </div>
        </>
      )}
      <Button
        type="submit"
        variant="secondary"
        disabled={disabled || busy}
        aria-label={t('add')}
        title={t('add')}
        className={cn(!compact && 'px-2.5 sm:px-4')}
      >
        {busy ? <Spinner /> : <PlusIcon />}
        <span className={cn(!compact && 'hidden sm:inline')}>{t('add')}</span>
      </Button>
      {problem && (
        <p id="quick-add-problem" role="alert" className="basis-full text-xs text-danger">
          {t('titleRequired')}
        </p>
      )}
    </form>
  );
}
