'use client';

import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  retentionDeleteAfterDays,
  retentionItemViewSchema,
  retentionPreviewSchema,
  type RetentionItemView,
  type RetentionOverview,
  type RetentionPreview,
  type RetentionValues,
} from '@crm/contracts';
import { Alert, Badge, Button, ConfirmDialog, Input, Switch } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { draftFromItem, hasImpact, isEdited, valuesOf, type ItemDraft } from './lib/draft';
import { errorKind } from './lib/errors';
import { formatBytes } from './lib/format';
import { DATA_RETENTION_QUERY_KEY } from './queries';

const NS = 'data-retention';

/** The days after writing that the data is deleted for good, or null when it is kept for ever. */
export function deletedAfter(
  item: Pick<RetentionItemView, 'canArchive'>,
  v: RetentionValues,
): number | null {
  return item.canArchive ? retentionDeleteAfterDays(v) : v.liveDays;
}

/**
 * One data item as one table row: its two numbers are editable in place, the row says when the data is deleted for good, how big it is,
 * what the last run did, and has its own Save and Reset. Saving first asks the server what would be archived or deleted and shows it.
 */
export function ItemRow({
  item,
  canEdit,
  archiveDriver,
}: {
  item: RetentionItemView;
  canEdit: boolean;
  archiveDriver: RetentionOverview['engine']['archiveDriver'];
}) {
  const t = useTranslations(NS);
  const f = useFormatter();
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState<ItemDraft>(() => draftFromItem(item));
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    values: RetentionValues;
    preview: RetentionPreview;
  } | null>(null);
  const [resetting, setResetting] = useState(false);

  const when = (iso: string) =>
    f.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const refresh = () => qc.invalidateQueries({ queryKey: DATA_RETENTION_QUERY_KEY });
  const onError = (err: unknown) => {
    const kind = errorKind(err);
    // The client already checked the ranges, so for the bell feed the one rule left is read-before-unread.
    toast.error(
      kind === 'validation' && item.id.startsWith('notifications_')
        ? t('validation.unread_before_read')
        : t(`errors.${kind}`),
    );
    if (kind === 'conflict') void refresh();
  };

  const check = useMutation({
    mutationFn: (values: RetentionValues) =>
      operatorFetch(`/data-retention/items/${item.id}/preview`, {
        method: 'POST',
        body: values,
        schema: retentionPreviewSchema,
      }),
    onError,
  });
  const save = useMutation({
    mutationFn: (values: RetentionValues) =>
      operatorFetch(`/data-retention/items/${item.id}`, {
        method: 'PATCH',
        body: { ...values, rowVersion: item.rowVersion },
        schema: retentionItemViewSchema,
      }),
    onSuccess: () => {
      toast.success(t('saved'));
      setPending(null);
      return refresh();
    },
    onError: (err) => {
      setPending(null);
      onError(err);
    },
  });
  const reset = useMutation({
    mutationFn: () =>
      operatorFetch(`/data-retention/items/${item.id}`, {
        method: 'DELETE',
        schema: retentionItemViewSchema,
      }),
    onSuccess: () => {
      toast.success(t('resetDone'));
      setResetting(false);
      setDraft(draftFromItem({ ...item, source: 'default', ...item.defaults }));
      return refresh();
    },
    onError: (err) => {
      setResetting(false);
      onError(err);
    },
  });

  const parsed = valuesOf(item, draft);
  const shown: RetentionValues =
    'values' in parsed ? parsed.values : { liveDays: item.liveDays, archiveDays: item.archiveDays };
  const edited = isEdited(item, draft);
  const gone = deletedAfter(item, shown);
  const itemName = t(`items.${item.id}.title`);

  const set = (patch: Partial<ItemDraft>) => {
    setProblem(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const submit = async () => {
    const r = valuesOf(item, draft);
    if (!('values' in r)) return setProblem(r.problem);
    const preview = await check.mutateAsync(r.values).catch(() => null);
    if (!preview) return;
    // Nothing archived or deleted by this change: no need to ask twice.
    if (!hasImpact(preview)) return save.mutate(r.values);
    setPending({ values: r.values, preview });
  };

  const liveBad =
    problem === 'live_out_of_range' ||
    (problem === 'not_a_number' && !/^\d+$/.test(draft.liveDays));
  const archiveBad = problem === 'archive_out_of_range';
  const fieldError = problem
    ? t(`validation.${problem}`, {
        min: archiveBad ? item.limits.archive.min : item.limits.live.min,
        max: archiveBad ? item.limits.archive.max : item.limits.live.max,
      })
    : undefined;
  const run = item.lastRun;
  const destructive =
    pending &&
    (pending.preview.toDeleteFromArchive.length > 0 || (pending.preview.rowsToDelete ?? 0) > 0);

  return (
    <tr
      id={`retention-${item.id}`}
      data-testid={`retention-${item.id}`}
      className="scroll-mt-20 border-b border-border/60 align-top"
    >
      <th scope="row" className="w-72 max-w-[18rem] py-3 ps-4 pe-3 text-start">
        <span className="block font-medium">{itemName}</span>
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
          {t(`table.where.${item.kind}`, { driver: archiveDriver === 's3' ? 'S3 / R2' : 'local' })}
        </span>
        <details className="mt-1 text-xs font-normal text-muted-foreground">
          <summary className="cursor-pointer select-none underline-offset-2 hover:underline">
            {t('table.about')}
          </summary>
          <p className="mt-1">{t(`items.${item.id}.description`)}</p>
        </details>
      </th>

      <td className="py-3 pe-3">
        <Input
          aria-label={`${itemName}: ${t('fields.liveDays')}`}
          type="number"
          inputMode="numeric"
          min={item.limits.live.min}
          max={item.limits.live.max}
          value={draft.liveDays}
          invalid={liveBad}
          disabled={!canEdit}
          className="w-24"
          data-testid={`retention-input-live-${item.id}`}
          onChange={(e) => set({ liveDays: e.target.value })}
        />
        <span className="mt-1 block text-[11px] text-muted-foreground">
          {item.limits.live.min}–{item.limits.live.max}
        </span>
      </td>

      <td className="py-3 pe-3">
        {item.canArchive ? (
          <div className="space-y-1.5">
            <Input
              aria-label={`${itemName}: ${t('fields.archiveDays')}`}
              type="number"
              inputMode="numeric"
              min={item.limits.archive.min}
              max={item.limits.archive.max}
              value={draft.archiveDays}
              invalid={archiveBad}
              disabled={!canEdit || draft.keepForever}
              className="w-24"
              data-testid={`retention-input-archive-${item.id}`}
              onChange={(e) => set({ archiveDays: e.target.value })}
            />
            <label className="flex items-center gap-2 text-xs" htmlFor={`${id}-forever`}>
              <Switch
                id={`${id}-forever`}
                checked={draft.keepForever}
                label={t('fields.keepForever')}
                disabled={!canEdit}
                onCheckedChange={(keepForever) => set({ keepForever })}
              />
              {t('fields.keepForeverShort')}
            </label>
          </div>
        ) : (
          <span className="text-muted-foreground">{t('table.noArchive')}</span>
        )}
      </td>

      <td className="py-3 pe-3 tabular-nums" data-testid={`retention-deleted-${item.id}`}>
        {gone === null ? t('table.never') : t('table.days', { count: gone })}
        {fieldError && (
          <span role="alert" className="mt-1 block max-w-[12rem] text-xs text-danger">
            {fieldError}
          </span>
        )}
      </td>

      <td className="min-w-[11rem] py-3 pe-3 text-xs" data-testid={`retention-live-${item.id}`}>
        {item.live.rows === null
          ? t('stats.liveValueNoRows', { size: formatBytes(item.live.bytes) })
          : t('stats.liveValue', {
              size: formatBytes(item.live.bytes),
              rows: f.number(item.live.rows),
            })}
        {item.live.partitions !== null && item.live.oldestMonth && (
          <span className="block text-muted-foreground">
            {t('stats.months', { count: item.live.partitions, oldest: item.live.oldestMonth })}
          </span>
        )}
        {item.canArchive && (
          <span
            className="mt-1 block text-muted-foreground"
            data-testid={`retention-archive-${item.id}`}
          >
            {item.archive
              ? `${t('stats.archive')}: ${t('stats.archiveValue', {
                  size: formatBytes(item.archive.bytes),
                  count: item.archive.objects,
                })}`
              : `${t('stats.archive')}: ${t('stats.archiveNone')}`}
          </span>
        )}
      </td>

      <td className="w-56 max-w-[14rem] py-3 pe-3 text-xs" data-testid={`retention-run-${item.id}`}>
        {run ? (
          run.mode === 'dry_run' ? (
            t('stats.runDry', { when: when(run.at) })
          ) : item.kind === 'table' || item.kind === 'file' ? (
            t('stats.runDeleted', { when: when(run.at), deleted: run.deletedRows })
          ) : item.kind === 'daily_archive' ? (
            t('stats.runDaily', {
              when: when(run.at),
              rows: f.number(run.deletedRows),
              expired: f.number(run.expiredItems),
            })
          ) : (
            t('stats.runLive', {
              when: when(run.at),
              months: run.archivedMonths,
              rows: f.number(run.archivedRows),
              size: formatBytes(run.archivedBytes),
              expired: f.number(run.expiredItems),
              deleted: f.number(run.deletedRows),
            })
          )
        ) : (
          <span className="text-muted-foreground">{t('stats.neverRun')}</span>
        )}
        {run?.error && (
          <span className="block text-danger">{t('stats.runFailed', { error: run.error })}</span>
        )}
      </td>

      <td className="py-3 pe-3">
        <div className="flex flex-col items-start gap-1">
          <Badge tone={item.source === 'custom' ? 'success' : 'neutral'}>
            {t(`status.${item.source}`)}
          </Badge>
          {!item.applied && <Badge tone="warning">{t('status.notApplied')}</Badge>}
          {item.updatedAt && (
            <span className="text-[11px] text-muted-foreground">
              {t('status.updated', { when: when(item.updatedAt) })}
            </span>
          )}
        </div>
      </td>

      <td className="py-3 pe-4">
        {canEdit && (
          <div className="flex flex-col items-stretch gap-1.5">
            <Button
              type="button"
              size="sm"
              disabled={!edited || check.isPending || save.isPending}
              data-testid={`retention-save-${item.id}`}
              onClick={() => void submit()}
            >
              {check.isPending
                ? t('actions.checking')
                : save.isPending
                  ? t('actions.saving')
                  : t('actions.save')}
            </Button>
            {item.source === 'custom' && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setResetting(true)}
                disabled={reset.isPending}
              >
                {t('actions.resetShort')}
              </Button>
            )}
          </div>
        )}
        <ConfirmDialog
          open={pending !== null}
          title={t('preview.title', { item: itemName })}
          message={
            pending && (
              <div className="space-y-2">
                <p>{t('preview.intro')}</p>
                <ul className="list-disc space-y-1 ps-5">
                  {pending.preview.toArchive.length > 0 && (
                    <li>
                      {t('preview.toArchive', {
                        count: pending.preview.toArchive.length,
                        rows: f.number(
                          pending.preview.toArchive.reduce((n, m) => n + (m.estimatedRows ?? 0), 0),
                        ),
                        size: formatBytes(
                          pending.preview.toArchive.reduce((n, m) => n + m.bytes, 0),
                        ),
                      })}
                    </li>
                  )}
                  {pending.preview.toDeleteFromArchive.length > 0 && (
                    <li>
                      {t('preview.toDeleteFromArchive', {
                        count: pending.preview.toDeleteFromArchive.length,
                      })}
                    </li>
                  )}
                  {(pending.preview.rowsToArchive ?? 0) > 0 && (
                    <li>
                      {t('preview.rowsToArchive', { count: pending.preview.rowsToArchive ?? 0 })}
                    </li>
                  )}
                  {(pending.preview.rowsToDelete ?? 0) > 0 && (
                    <li>
                      {t('preview.rowsToDelete', { count: pending.preview.rowsToDelete ?? 0 })}
                    </li>
                  )}
                </ul>
                {!item.applied && <Alert tone="warning">{t('preview.notApplied')}</Alert>}
                {destructive && <p className="font-medium">{t('preview.permanent')}</p>}
              </div>
            )
          }
          confirmLabel={t('actions.confirmSave')}
          cancelLabel={t('actions.cancel')}
          tone={destructive ? 'danger' : 'default'}
          busy={save.isPending}
          onConfirm={() => pending && save.mutate(pending.values)}
          onClose={() => setPending(null)}
        />
        <ConfirmDialog
          open={resetting}
          title={t('actions.resetTitle', { item: itemName })}
          message={t('actions.resetBody')}
          confirmLabel={t('actions.confirmReset')}
          cancelLabel={t('actions.cancel')}
          busy={reset.isPending}
          onConfirm={() => reset.mutate()}
          onClose={() => setResetting(false)}
        />
      </td>
    </tr>
  );
}
