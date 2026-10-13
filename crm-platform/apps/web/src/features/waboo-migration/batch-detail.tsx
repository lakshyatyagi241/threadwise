'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { wabooMigrationBatchDetailSchema } from '@crm/contracts';
import { Badge, Button } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKind } from './lib/errors';
import { BATCHES_QUERY_KEY, batchQueryKey, isBatchActive, useBatch } from './queries';
import { StatusBadge, StepList, VerdictBadge, VerdictBlock } from './run-parts';
import { ErrorBlock, LoadingBlock } from './state';

const NS = 'waboo-migration.batch';

/**
 * One bulk batch: its progress and, per organization (in the order they run), the status, verdict and step timeline, live.
 * Organizations run one after another. Each row is a card that stacks on a phone.
 */
export function BatchDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations(NS);
  const tm = useTranslations('waboo-migration.mode');
  const tbs = useTranslations('waboo-migration.batchStatus');
  const te = useTranslations('waboo-migration.common.errors');
  const format = useFormatter();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useBatch(id);

  const cancel = useMutation({
    mutationFn: () =>
      operatorFetch(`/waboo-migration/batches/${id}/cancel`, {
        method: 'POST',
        schema: wabooMigrationBatchDetailSchema,
      }),
    onSuccess: async () => {
      toast.success(t('cancelled'));
      await Promise.all([
        qc.invalidateQueries({ queryKey: batchQueryKey(id) }),
        qc.invalidateQueries({ queryKey: BATCHES_QUERY_KEY }),
      ]);
    },
    onError: (err) => {
      toast.error(te(errorKind(err)));
      void qc.invalidateQueries({ queryKey: batchQueryKey(id) });
    },
  });

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data;
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  const finished = b.items.filter((i) => !['queued', 'running'].includes(i.status)).length;
  const tone =
    b.status === 'completed'
      ? 'success'
      : b.status === 'failed'
        ? 'danger'
        : b.status === 'running'
          ? 'warning'
          : 'neutral';

  return (
    <section className="space-y-4 rounded-md border border-border p-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {t('title', { count: b.total })}
        </h2>
        <Badge>{tm(b.mode)}</Badge>
        <Badge tone={tone}>{tbs(b.status)}</Badge>
        {isBatchActive(b) && (
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
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t('progress')}</dt>
          <dd className="font-mono">
            {finished} / {b.total}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('runAt')}</dt>
          <dd>{when(b.runAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('started')}</dt>
          <dd>{when(b.startedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('finished')}</dt>
          <dd>{when(b.finishedAt)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        {b.stopOnFailure ? t('stopOn') : t('stopOff')} {isBatchActive(b) ? t('polling') : ''}
      </p>

      <ol className="space-y-3">
        {b.items.map((r) => (
          <li key={r.id} className="space-y-3 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">#{r.position}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
                {r.organizationId}
              </span>
              <StatusBadge run={r} />
              <VerdictBadge verdict={r.verdict} />
            </div>
            {r.steps.length > 0 && <StepList steps={r.steps} compact />}
            <VerdictBlock run={r} />
            {r.error && <p className="break-words text-xs text-danger">{r.error}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
