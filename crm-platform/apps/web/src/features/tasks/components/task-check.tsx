'use client';

import type { TaskResponse } from '@crm/contracts';
import { isPending } from '../lib/inline-tasks';
import type { TaskSource } from '../api/service';
import { CompleteCheck, useTasksCan, useWorkspaceZone } from './parts';
import { useTaskActions } from './use-task-actions';

/**
 * The tick of one task on a record's screen (the contact's timeline): complete or reopen it in place. The list changes at once and a
 * refusal puts the task back with the reason (the same action the Tasks list of the record uses). Drawn disabled for someone who may
 * not update tasks, and while the task is still being created.
 */
export function TaskCompleteCheck({
  task,
  source,
  onChanged,
  className,
}: {
  task: TaskResponse;
  /** The record whose list the task is in (so its cached rows change). */
  source: Exclude<TaskSource, { kind: 'all' }>;
  onChanged?: () => void;
  className?: string;
}) {
  const can = useTasksCan();
  const actions = useTaskActions();
  const zone = useWorkspaceZone();
  return (
    <CompleteCheck
      className={className}
      done={task.status === 'done'}
      title={task.title}
      disabled={!can.update || isPending(task.id)}
      onToggle={() =>
        void actions.toggleOptimistic(task, source, zone).then((next) => next && onChanged?.())
      }
    />
  );
}
