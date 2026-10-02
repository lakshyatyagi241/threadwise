'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { TaskBucket, TaskResponse } from '@crm/contracts';
import { BUCKET_ORDER, groupByBucket } from '../lib/dates';
import { Avatar, CompleteCheck, DueText, PriorityChip, RecordPill } from './parts';

const TONE: Record<TaskBucket, string> = {
  overdue: 'text-danger',
  today: 'text-brand dark:text-primary',
  upcoming: 'text-foreground',
  no_date: 'text-muted-foreground',
};

/**
 * The board view: WaDesk's four cards (Overdue, Today, Upcoming, No date) for the open tasks that are loaded. Columns are the
 * due-date buckets, not a status you drag between: a task changes bucket by changing its due date.
 */
export function TasksBoard({
  tasks,
  now,
  zone,
  canUpdate,
  selected,
  onOpen,
  onToggleComplete,
}: {
  tasks: readonly TaskResponse[];
  now: Date;
  zone: string | undefined;
  canUpdate: boolean;
  selected: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onToggleComplete: (task: TaskResponse) => void;
}) {
  const t = useTranslations('tasks.board');
  const groups = useMemo(() => groupByBucket(tasks, now, zone), [tasks, now, zone]);
  return (
    <div className="thin-scrollbar grid min-h-0 flex-1 gap-3 overflow-auto p-3 sm:grid-cols-2 xl:grid-cols-4">
      {BUCKET_ORDER.map((b) => (
        <section
          key={b}
          aria-labelledby={`board-${b}`}
          className="flex min-h-40 flex-col rounded-lg border border-border bg-muted/30"
        >
          <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <h3 id={`board-${b}`} className={cn('text-sm font-semibold', TONE[b])}>
              {t(`buckets.${b}`)}
            </h3>
            <span className="text-xs tabular-nums text-muted-foreground">{groups[b].length}</span>
          </header>
          {groups[b].length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="space-y-2 p-2">
              {groups[b].map((task) => (
                <li
                  key={task.id}
                  className={cn(
                    'flex items-start gap-2.5 rounded-md border border-border bg-background p-3',
                    selected.has(task.id) && 'border-brand/50 bg-brand/5',
                  )}
                >
                  <CompleteCheck
                    className="mt-0.5"
                    done={task.status === 'done'}
                    title={task.title}
                    disabled={!canUpdate}
                    onToggle={() => onToggleComplete(task)}
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => onOpen(task.id)}
                      dir="auto"
                      className="block w-full break-words text-start text-sm font-medium leading-snug outline-none hover:text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {task.title}
                    </button>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <PriorityChip priority={task.priority} />
                      {task.dueAt && <DueText task={task} now={now} zone={zone} />}
                    </div>
                    {(task.contact || task.deal) && (
                      <div className="flex flex-wrap gap-1">
                        {task.contact && (
                          <RecordPill kind="contact" id={task.contact.id} label={task.contact.name} />
                        )}
                        {task.deal && <RecordPill kind="deal" id={task.deal.id} label={task.deal.title} />}
                      </div>
                    )}
                  </div>
                  {task.assignee && <Avatar name={task.assignee.name} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
