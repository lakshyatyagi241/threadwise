'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { wabooMigrationRunSchema } from '@crm/contracts';
import { Alert, Badge, Button } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKind } from './lib/errors';
import { RUNS_QUERY_KEY, isActive, runQueryKey, useRun } from './queries';
import { StatusBadge, StepList, VerdictBlock } from './run-parts';
import { ErrorBlock, LoadingBlock } from './state';

const NS = 'waboo-migration.detail';

/** One run: live step timeline, the green / review-alarms / red verdict with its numbers, the schedule and the error text. */
export function RunDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations(NS);
  const tm = useTranslations('waboo-migration.mode');
  const te = useTranslations('waboo-migration.common.errors');
  const format = useFormatter();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useRun(id);

  const cancel = useMutation({
    mutationFn: () =>
      operatorFetch(`/waboo-migration/runs/${id}/cancel`, {
        method: 'POST',
        schema: wabooMigrationRunSchema,
      }),
    onSuccess: async () => {
      toast.success(t('cancelled'));
      await Promise.all([
        qc.invalidateQueries({ queryKey: runQueryKey(id) }),
        qc.invalidateQueries({ queryKey: RUNS_QUERY_KEY }),
      ]);
    },
    onError: (err) => {
      toast.error(te(errorKind(err)));
      void qc.invalidateQueries({ queryKey: runQueryKey(id) });
    },
  });

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const run = q.data;
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'medium' }) : '-';

  return (
    <section className="space-y-4 rounded-md border border-border p-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {t('title', { org: run.organizationId })}
        </h2>
        <Badge>{tm(run.mode)}</Badge>
        <StatusBadge run={run} />
        {run.status === 'queued' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending}
          >
            {cancel.isPending ? t('cancelling') : t('cancel')}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('back')}
        </Button>
      </div>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t('clientKey')}</dt>
          <dd className="font-mono">{run.sourceClient}</dd>
        </div>
        {run.runAt && (
          <div>
            <dt className="text-xs text-muted-foreground">{t('runAt')}</dt>
            <dd>{when(run.runAt)}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">{t('started')}</dt>
          <dd>{when(run.startedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('finished')}</dt>
          <dd>{when(run.finishedAt)}</dd>
        </div>
      </dl>
      {isActive(run) && <p className="text-xs text-muted-foreground">{t('polling')}</p>}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t('steps')}</h3>
        <StepList steps={run.steps} />
      </div>

      {run.verdict && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('report')}</h3>
          <VerdictBlock run={run} />
        </div>
      )}

      {run.error && (
        <Alert tone="danger" className="space-y-1">
          <p className="font-medium">{t('error')}</p>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs">{run.error}</pre>
        </Alert>
      )}
    </section>
  );
}
