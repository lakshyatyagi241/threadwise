'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { Alert, Button, Spinner, useToast } from '@crm/ui';
import {
  ERROR_CODES,
  taskOutcomeResponseSchema,
  type ActivityOption,
  type TaskOutcomeResponse,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { OptionList } from './option-list';

/** The same cache key the task screens use for the outcome list, so a change here shows there at once. */
const KEY = ['tasks', 'outcomes', false] as const;
const listSchema = z.array(taskOutcomeResponseSchema);

const asOption = (o: TaskOutcomeResponse, i: number): ActivityOption => ({
  id: o.id,
  kind: 'outcome',
  key: o.id,
  name: o.name,
  isSystem: false,
  countsAs: null,
  position: i,
});

const send = (path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown) =>
  apiFetch<void>(path, { method, body });

/**
 * The outcomes of the Task activity. They are the workspace's task outcomes (`task_outcomes`, the list the outcome picker on a task and
 * the Waboo migration use), edited here through that feature's own routes: no second list. Remove keeps the tasks that have an outcome:
 * a used outcome is hidden (the tasks still show it), an unused one is deleted. Adding a name that was hidden brings it back. Changing
 * needs `settings.task_outcomes.manage`, the same key the old standalone screen asked for.
 */
export function TaskOutcomesList({ canManage }: { canManage: boolean }) {
  const t = useTranslations('sales-activities.drawer');
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => apiFetch('/task-outcomes', { schema: listSchema, signal }),
    staleTime: 30_000,
  });
  const all = q.data ?? [];
  const visible = all.filter((o) => o.isActive);

  const errorText = (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.code === ERROR_CODES.TASK_OUTCOME_NAME_TAKEN) return t('errors.nameTaken');
      if (e.code === ERROR_CODES.ROW_VERSION_CONFLICT) return t('errors.conflict');
      if (e.code === ERROR_CODES.FORBIDDEN) return t('errors.forbidden');
    }
    return t('errors.failed');
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks'] });
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSettled: refresh,
    onError: (e) => toast(errorText(e), 'danger'),
  });

  const find = (o: ActivityOption) => all.find((x) => x.id === o.id)!;

  const add = async (name: string): Promise<boolean> => {
    const hidden = all.find(
      (x) => !x.isActive && x.name.trim().toLowerCase() === name.toLowerCase(),
    );
    try {
      if (hidden) {
        await send(`/task-outcomes/${hidden.id}`, 'PATCH', {
          isActive: true,
          rowVersion: hidden.rowVersion,
        });
      } else await send('/task-outcomes', 'POST', { name });
      await refresh();
      return true;
    } catch (e) {
      toast(errorText(e), 'danger');
      return false;
    }
  };

  return (
    <>
      {q.isPending && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loadingOutcomes')}
        </p>
      )}
      {q.isError && (
        <Alert tone="danger">
          <p>{t('outcomesLoadFailed')}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void q.refetch()}>
            {t('retry')}
          </Button>
        </Alert>
      )}
      {q.isSuccess && (
        <OptionList
          title={t('outcomes')}
          hint={t('outcomesHint')}
          items={visible.map(asOption)}
          nameOf={(o) => o.name ?? ''}
          disabled={!canManage}
          busy={run.isPending}
          addLabel={t('addOutcome')}
          placeholder={t('outcomePlaceholder')}
          onAdd={add}
          onRename={(o, name) => {
            const row = find(o);
            run.mutate(() =>
              send(`/task-outcomes/${row.id}`, 'PATCH', { name, rowVersion: row.rowVersion }),
            );
          }}
          onRemove={(o) => {
            const row = find(o);
            run.mutate(async () => {
              if (row.taskCount > 0) {
                await send(`/task-outcomes/${row.id}`, 'PATCH', {
                  isActive: false,
                  rowVersion: row.rowVersion,
                });
                toast(t('hiddenInstead'));
              } else await send(`/task-outcomes/${row.id}`, 'DELETE');
            });
          }}
          onReorder={(ids) => {
            // The route wants every outcome once: the new visible order, then the hidden ones.
            const hiddenIds = all.filter((x) => !x.isActive).map((x) => x.id);
            run.mutate(() =>
              send('/task-outcomes/order', 'PUT', { outcomeIds: [...ids, ...hiddenIds] }),
            );
          }}
        />
      )}
    </>
  );
}
