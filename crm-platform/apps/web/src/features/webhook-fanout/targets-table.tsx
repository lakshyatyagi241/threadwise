'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  webhookDeliveryResultSchema,
  webhookTargetItemSchema,
  webhookTargetsResponseSchema,
  type WebhookDeliveryResult,
  type WebhookTargetItem,
} from '@crm/contracts';
import { Badge, Button, ConfirmDialog, EmptyState, Switch } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKind } from './lib/errors';
import { TARGETS_QUERY_KEY } from './queries';
import { ErrorBlock, LoadingBlock } from './state';
import { TargetDialog } from './target-dialog';

const NS = 'webhook-fanout.targets';

/** The target list with its row actions, and the add/edit dialog. `adding` is owned by the page header's button. */
export function TargetsTable({
  adding,
  onCloseAdd,
  onAdd,
}: {
  adding: boolean;
  onCloseAdd: () => void;
  onAdd: () => void;
}) {
  const t = useTranslations(NS);
  const tc = useTranslations('webhook-fanout.common');
  const tp = useTranslations('webhook-fanout.page');
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<WebhookTargetItem | null>(null);
  const [deleting, setDeleting] = useState<WebhookTargetItem | null>(null);
  const [results, setResults] = useState<Record<string, WebhookDeliveryResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: TARGETS_QUERY_KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/webhook-targets', { schema: webhookTargetsResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: TARGETS_QUERY_KEY });
  const fail = (err: unknown) => {
    const kind = errorKind(err);
    toast.error(tc(`errors.${kind}`));
    if (kind === 'conflict' || kind === 'notFound') void refresh();
  };

  const toggle = useMutation({
    mutationFn: (v: { item: WebhookTargetItem; isActive: boolean }) =>
      operatorFetch(`/webhook-targets/${v.item.id}`, {
        method: 'PATCH',
        body: { rowVersion: v.item.rowVersion, isActive: v.isActive },
        schema: webhookTargetItemSchema,
      }),
    onSuccess: (saved) => {
      toast.success(t(saved.isActive ? 'toasts.on' : 'toasts.off', { name: saved.name }));
      return refresh();
    },
    onError: fail,
  });
  const test = useMutation({
    mutationFn: (item: WebhookTargetItem) => {
      setTestingId(item.id);
      return operatorFetch(`/webhook-targets/${item.id}/test`, {
        method: 'POST',
        schema: webhookDeliveryResultSchema,
      });
    },
    onSuccess: (result, item) => {
      setResults((r) => ({ ...r, [item.id]: result }));
      return refresh();
    },
    onError: fail,
    onSettled: () => setTestingId(null),
  });
  const remove = useMutation({
    mutationFn: (item: WebhookTargetItem) =>
      operatorFetch(`/webhook-targets/${item.id}`, { method: 'DELETE' }),
    onSuccess: (_void, item) => {
      toast.success(t('toasts.deleted', { name: item.name }));
      setDeleting(null);
      return refresh();
    },
    onError: (err) => {
      setDeleting(null);
      fail(err);
    },
  });

  const dialog =
    adding || editing ? (
      <TargetDialog
        key={editing ? `${editing.id}:${editing.rowVersion}` : 'new'}
        target={editing}
        onClose={() => {
          setEditing(null);
          onCloseAdd();
        }}
      />
    ) : null;

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data.data;

  return (
    <>
      {rows.length === 0 ? (
        <EmptyState
          title={t('empty')}
          message={t('emptyBody')}
          actions={<Button onClick={onAdd}>{tp('add')}</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[56rem] text-start text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {(['target', 'active', 'fields', 'deliveries', 'last', 'actions'] as const).map(
                  (c) => (
                    <th key={c} scope="col" className="px-3 py-2 text-start font-medium">
                      {t(`columns.${c}`)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((item) => (
                <TargetRow
                  key={item.id}
                  item={item}
                  result={results[item.id]}
                  testing={testingId === item.id}
                  busy={toggle.isPending || remove.isPending}
                  onToggle={(isActive) => toggle.mutate({ item, isActive })}
                  onTest={() => test.mutate(item)}
                  onEdit={() => setEditing(item)}
                  onDelete={() => setDeleting(item)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog}
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        message={t('deleteBody')}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('cancel')}
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

function TargetRow({
  item,
  result,
  testing,
  busy,
  onToggle,
  onTest,
  onEdit,
  onDelete,
}: {
  item: WebhookTargetItem;
  result: WebhookDeliveryResult | undefined;
  testing: boolean;
  busy: boolean;
  onToggle: (isActive: boolean) => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations(NS);
  const format = useFormatter();
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const lastAt =
    item.lastFailureAt && (!item.lastSuccessAt || item.lastFailureAt > item.lastSuccessAt)
      ? item.lastFailureAt
      : item.lastSuccessAt;
  const hasLast = item.lastStatus !== null || item.lastError !== null || lastAt !== null;

  return (
    <tr className="align-top">
      <th scope="row" className="max-w-[18rem] px-3 py-3 text-start font-normal">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.name}</span>
          {item.pendingFailures > 0 && (
            <Badge tone="danger" aria-label={t('pendingLabel', { count: item.pendingFailures })}>
              {t('pending', { count: item.pendingFailures })}
            </Badge>
          )}
        </div>
        <p className="break-all font-mono text-xs text-muted-foreground" dir="ltr">
          {item.url}
        </p>
      </th>
      <td className="px-3 py-3">
        <Switch
          checked={item.isActive}
          disabled={busy}
          onCheckedChange={onToggle}
          label={t('activeSwitch', { name: item.name })}
        />
      </td>
      <td className="px-3 py-3">
        {item.fieldFilter.length === 0 ? (
          <span className="text-muted-foreground">{t('allFields')}</span>
        ) : (
          <ul className="flex max-w-[14rem] flex-wrap gap-1">
            {item.fieldFilter.map((f) => (
              <li key={f} className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs" dir="ltr">
                {f}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1">
          <Badge tone="success">{t('success', { count: item.successCount })}</Badge>
          <span title={t('failureHint')}>
            <Badge tone={item.failureCount > 0 ? 'danger' : 'neutral'}>
              {t('failure', { count: item.failureCount })}
            </Badge>
          </span>
        </div>
      </td>
      <td className="max-w-[16rem] px-3 py-3 text-xs">
        {hasLast ? (
          <div className="space-y-0.5">
            {item.lastStatus !== null && <p>{t('lastStatus', { status: item.lastStatus })}</p>}
            {item.lastError && (
              <p className="break-words text-danger">{t('lastError', { error: item.lastError })}</p>
            )}
            {lastAt && (
              <p className="text-muted-foreground">{t('lastAt', { time: when(lastAt) })}</p>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">{t('neverDelivered')}</span>
        )}
        <div aria-live="polite">
          {result && (
            <p className={result.ok ? 'mt-1 text-success' : 'mt-1 text-danger'}>
              {result.ok
                ? t('testOk', { status: result.statusCode ?? 0, ms: result.latencyMs })
                : t('testFailed', {
                    reason:
                      result.error ??
                      (result.statusCode !== null
                        ? t('testStatus', { status: result.statusCode })
                        : t('testNoStatus')),
                    ms: result.latencyMs,
                  })}
            </p>
          )}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${t('edit')}: ${item.name}`}
            onClick={onEdit}
          >
            {t('edit')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={testing}
            aria-label={`${t('test')}: ${item.name}`}
            onClick={onTest}
          >
            {testing ? t('testing') : t('test')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${t('delete')}: ${item.name}`}
            onClick={onDelete}
          >
            {t('delete')}
          </Button>
        </div>
      </td>
    </tr>
  );
}
