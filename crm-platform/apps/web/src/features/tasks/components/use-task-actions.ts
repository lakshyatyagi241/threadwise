'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { CreateTaskInput, TaskResponse } from '@crm/contracts';
import { useToast } from '@crm/ui';
import { invalidateTasks, patchTaskInCache, removeTaskFromCache } from '../api/hooks';
import { tasksApi } from '../api/service';
import { errorKind } from '../lib/errors';
import type { TaskPatch } from '../lib/task-form';
import { useErrorText } from './parts';

/**
 * Every write the screens make, with the same behaviour everywhere: the cached lists change at once, the lists and the
 * badges refetch, the person gets a toast, and a 409 says "reload" instead of retrying (the task moved underneath them).
 */
export function useTaskActions() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const t = useTranslations('tasks.toast');
  const errorText = useErrorText();

  const failed = (e: unknown, key: 'failed' | 'saveFailed' | 'deleteFailed' | 'createFailed') => {
    toast(errorKind(e) === 'conflict' ? t('conflict') : `${t(key)} ${errorText(e)}`, 'danger');
    void invalidateTasks(qc);
  };

  return {
    /** A task was written outside the actions (the form): show it in the cached lists and refetch. */
    refresh(task: TaskResponse): void {
      patchTaskInCache(qc, task);
      void invalidateTasks(qc);
    },

    /** Completes an open task or reopens a done one. Resolves to the task as the server has it, or null on failure. */
    async toggle(
      task: Pick<TaskResponse, 'id' | 'status' | 'title'>,
    ): Promise<TaskResponse | null> {
      const reopening = task.status === 'done';
      try {
        const next = reopening ? await tasksApi.reopen(task.id) : await tasksApi.complete(task.id);
        patchTaskInCache(qc, next);
        void invalidateTasks(qc);
        toast(reopening ? t('reopened') : t('completed'), 'success');
        return next;
      } catch (e) {
        failed(e, 'failed');
        return null;
      }
    },

    async create(input: CreateTaskInput, quiet = false): Promise<TaskResponse | null> {
      try {
        const next = await tasksApi.create(input);
        void invalidateTasks(qc);
        if (!quiet) toast(t('created'), 'success');
        return next;
      } catch (e) {
        failed(e, 'createFailed');
        return null;
      }
    },

    async save(
      task: Pick<TaskResponse, 'id' | 'rowVersion'>,
      patch: TaskPatch,
      quiet = false,
    ): Promise<TaskResponse | null> {
      if (Object.keys(patch).length === 0) return null;
      try {
        const next = await tasksApi.update(task, patch);
        patchTaskInCache(qc, next);
        void invalidateTasks(qc);
        if (!quiet) toast(t('saved'), 'success');
        return next;
      } catch (e) {
        failed(e, 'saveFailed');
        return null;
      }
    },

    async remove(id: string): Promise<boolean> {
      try {
        await tasksApi.remove(id);
        removeTaskFromCache(qc, new Set([id]));
        void invalidateTasks(qc);
        toast(t('deleted'), 'success');
        return true;
      } catch (e) {
        failed(e, 'deleteFailed');
        return false;
      }
    },
  };
}
