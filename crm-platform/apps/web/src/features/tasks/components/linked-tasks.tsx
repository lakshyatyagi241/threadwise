'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, EmptyState, Spinner, cn } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useTasksList, useTasksSetup } from '../api/hooks';
import { isUnavailable } from '../lib/errors';
import { Avatar, CompleteCheck, DueText, ErrorLine, PriorityChip, useNow, useTasksCan, useWorkspaceZone } from './parts';
import { QuickAdd, type QuickAddValue } from './quick-add';
import { useTaskActions } from './use-task-actions';

export interface LinkedTasksProps {
  /** The record whose tasks are listed, and the link a new task gets. */
  kind: 'contact' | 'deal';
  id: string;
  /** A short heading style for narrow panels (the deal drawer). */
  compact?: boolean;
  className?: string;
  /** Called after a task was added, completed or reopened here (the deal drawer refreshes its timeline, which mirrors them). */
  onChanged?: () => void;
}

/**
 * The tasks of one contact or deal: open ones first, a quick add that links the new task to the record, a switch for the
 * completed ones, and a link to the Tasks hub filtered to the record. Shared by the contact page and the deal drawer, so
 * both behave the same. Renders nothing for someone who may not read tasks.
 */
export function LinkedTasks({ kind, id, compact, className, onChanged }: LinkedTasksProps) {
  const can = useTasksCan();
  if (!can.read) return null;
  return <Panel kind={kind} id={id} compact={compact} className={className} onChanged={onChanged} can={can} />;
}

function Panel({
  kind,
  id,
  compact,
  className,
  onChanged,
  can,
}: LinkedTasksProps & { can: ReturnType<typeof useTasksCan> }) {
  const t = useTranslations('tasks.linked');
  const session = useSession();
  const actions = useTaskActions();
  const now = useNow();
  const zone = useWorkspaceZone();
  const [showDone, setShowDone] = useState(false);
  useTasksSetup();
  const source = { kind, id } as const;
  const open = useTasksList(source, { status: 'open' }, { limit: 50 });
  const done = useTasksList(source, { status: 'done', sort: 'completed' }, { limit: 50, enabled: showDone });
  const heading = `linked-tasks-${kind}-${id}`;
  const hub = `/tasks?tab=all&status=all&${kind}=${id}`;

  async function add(v: QuickAddValue): Promise<boolean> {
    const next = await actions.create({
      title: v.title,
      priority: v.priority,
      dueAt: v.dueAt,
      assigneeId: session.user.id,
      ...(kind === 'contact' ? { contactId: id } : { dealId: id }),
    });
    if (next !== null) onChanged?.();
    return next !== null;
  }

  const rows = [...open.items, ...(showDone ? done.items : [])];

  return (
    <section
      aria-labelledby={heading}
      className={cn(
        compact ? 'space-y-3' : 'space-y-3 rounded-md border border-border bg-background p-4 sm:p-5',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id={heading}
          className={cn(
            compact
              ? 'text-sm font-semibold'
              : 'text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
          )}
        >
          {t('title')}
          {open.isSuccess && (
            <span className="ms-2 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium normal-case tracking-normal text-muted-foreground">
              {open.items.length}
              {open.hasNextPage ? '+' : ''}
            </span>
          )}
        </h2>
        <Link
          href={hub}
          className="text-xs text-brand underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none dark:text-primary"
        >
          {t('viewAll')}
        </Link>
      </div>

      {can.create && <QuickAdd compact onAdd={add} />}

      {open.isPending ? (
        <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : open.isError ? (
        isUnavailable(open.error) ? (
          <EmptyState title={t('unavailableTitle')} message={t('unavailable')} />
        ) : (
          <ErrorLine error={open.error} onRetry={() => void open.refetch()} />
        )
      ) : rows.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((task) => {
            const isDone = task.status === 'done';
            return (
              <li key={task.id} className="flex items-start gap-2.5 px-3 py-2.5">
                <CompleteCheck
                  className="mt-0.5"
                  done={isDone}
                  title={task.title}
                  disabled={!can.update}
                  onToggle={() => void actions.toggle(task).then((next) => next && onChanged?.())}
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/tasks?tab=all&status=all&task=${task.id}`}
                    dir="auto"
                    className={cn(
                      'block break-words text-sm font-medium leading-snug outline-none hover:text-primary hover:underline focus-visible:underline',
                      isDone && 'text-muted-foreground line-through',
                    )}
                  >
                    {task.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                    <PriorityChip priority={task.priority} />
                    <DueText task={task} now={now} zone={zone} />
                  </div>
                </div>
                {task.assignee && (
                  <span title={task.assignee.name}>
                    <Avatar name={task.assignee.name} />
                    <span className="sr-only">{task.assignee.name}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {open.hasNextPage && (
          <Button
            variant="secondary"
            size="sm"
            disabled={open.isFetchingNextPage}
            onClick={() => void open.fetchNextPage()}
          >
            {open.isFetchingNextPage && <Spinner />}
            {t('loadMore')}
          </Button>
        )}
        <button
          type="button"
          aria-pressed={showDone}
          onClick={() => setShowDone((v) => !v)}
          className="text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          {showDone ? t('hideDone') : t('showDone')}
        </button>
        {showDone && done.hasNextPage && (
          <Button
            variant="secondary"
            size="sm"
            disabled={done.isFetchingNextPage}
            onClick={() => void done.fetchNextPage()}
          >
            {t('loadMoreDone')}
          </Button>
        )}
      </div>
    </section>
  );
}
