'use client';

import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  webhookDeliveryResultSchema,
  webhookFailuresResponseSchema,
  webhookTargetsResponseSchema,
  type WebhookDeliveryResult,
  type WebhookFailureItem,
} from '@crm/contracts';
import { Badge, Button, EmptyState, Select } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKind } from './lib/errors';
import { FAILURES_QUERY_KEY, TARGETS_QUERY_KEY } from './queries';
import { ErrorBlock, LoadingBlock } from './state';

const NS = 'webhook-fanout.failures';

/** Deliveries that ran out of retries, with a Replay button per row. */
export function FailuresPanel() {
  const t = useTranslations(NS);
  const tc = useTranslations('webhook-fanout.common');
  const format = useFormatter();
  const toast = useToast();
  const qc = useQueryClient();
  const filterId = useId();
  const [targetId, setTargetId] = useState('');
  const [results, setResults] = useState<Record<string, WebhookDeliveryResult>>({});
  const [replayingId, setReplayingId] = useState<string | null>(null);

  const targets = useQuery({
    queryKey: TARGETS_QUERY_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/webhook-targets', { schema: webhookTargetsResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });
  const q = useQuery({
    queryKey: [...FAILURES_QUERY_KEY, targetId],
    queryFn: ({ signal }) =>
      operatorFetch('/webhook-targets/failures', {
        query: { targetId: targetId || undefined, limit: 100 },
        schema: webhookFailuresResponseSchema,
        signal,
      }),
    refetchOnWindowFocus: false,
  });

  const replay = useMutation({
    mutationFn: (item: WebhookFailureItem) => {
      setReplayingId(item.id);
      return operatorFetch(`/webhook-targets/failures/${item.id}/replay`, {
        method: 'POST',
        schema: webhookDeliveryResultSchema,
      });
    },
    onSuccess: async (result, item) => {
      setResults((r) => ({ ...r, [item.id]: result }));
      await Promise.all([
        qc.invalidateQueries({ queryKey: FAILURES_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: TARGETS_QUERY_KEY }),
      ]);
    },
    onError: (err) => {
      const kind = errorKind(err);
      toast.error(tc(`errors.${kind}`));
      if (kind === 'notFound') void qc.invalidateQueries({ queryKey: FAILURES_QUERY_KEY });
    },
    onSettled: () => setReplayingId(null),
  });

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const reason = (r: { error: string | null; statusCode: number | null }) =>
    r.error ??
    (r.statusCode !== null ? t('reasonStatus', { status: r.statusCode }) : t('reasonNone'));

  return (
    <div className="space-y-4">
      <div className="flex max-w-xs flex-col gap-1.5 text-sm">
        <label htmlFor={filterId} className="font-medium">
          {t('filterLabel')}
        </label>
        <Select id={filterId} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">{t('filterAll')}</option>
          {targets.data?.data.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </div>

      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.data.length === 0 ? (
        <EmptyState title={t('empty')} message={t('emptyBody')} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[44rem] text-start text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {(['target', 'when', 'attempts', 'reason', 'size', 'actions'] as const).map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`columns.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.data.map((item) => {
                const result = results[item.id];
                return (
                  <tr key={item.id} className="align-top">
                    <th scope="row" className="px-3 py-3 text-start font-medium">
                      {item.targetName}
                    </th>
                    <td className="px-3 py-3 text-xs">{when(item.createdAt)}</td>
                    <td className="px-3 py-3">{t('attempts', { count: item.attempts })}</td>
                    <td className="max-w-[18rem] break-words px-3 py-3 text-xs text-danger">
                      {reason(item)}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {t('bytes', { count: item.bodyBytes })}
                    </td>
                    <td className="px-3 py-3">
                      {item.replayedAt ? (
                        <Badge tone="success">
                          {t('replayed', { time: when(item.replayedAt) })}
                        </Badge>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={replayingId === item.id}
                          aria-label={`${t('replay')}: ${item.targetName}`}
                          onClick={() => replay.mutate(item)}
                        >
                          {replayingId === item.id ? t('replaying') : t('replay')}
                        </Button>
                      )}
                      <div aria-live="polite">
                        {result && (
                          <p
                            className={
                              result.ok ? 'mt-1 text-xs text-success' : 'mt-1 text-xs text-danger'
                            }
                          >
                            {result.ok
                              ? t('replayOk', {
                                  status: result.statusCode ?? 0,
                                  ms: result.latencyMs,
                                })
                              : t('replayFailed', { reason: reason(result), ms: result.latencyMs })}
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
