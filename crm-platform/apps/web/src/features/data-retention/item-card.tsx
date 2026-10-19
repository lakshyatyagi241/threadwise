'use client';

import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  retentionItemViewSchema,
  retentionPreviewSchema,
  type RetentionItemView,
  type RetentionPreview,
  type RetentionValues,
} from '@crm/contracts';
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Input, Switch } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import {
  draftFromItem,
  hasImpact,
  isChanged,
  summaryOf,
  valuesOf,
  type ItemDraft,
} from './lib/draft';
import { errorKind } from './lib/errors';
import { formatBytes } from './lib/format';
import { DATA_RETENTION_QUERY_KEY } from './queries';

const NS = 'data-retention';

/** One data item: its two numbers, what they mean, how big it is now, what the last run did, and the buttons that change it. */
export function ItemCard({ item, canEdit }: { item: RetentionItemView; canEdit: boolean }) {
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
  const shown =
    'values' in parsed ? parsed.values : { liveDays: item.liveDays, archiveDays: item.archiveDays };
  const summary = summaryOf(item, shown);
  const changed = isChanged(item, draft);

  const set = (patch: Partial<ItemDraft>) => {
    setProblem(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = valuesOf(item, draft);
    if (!('values' in r)) return setProblem(r.problem);
    const preview = await check.mutateAsync(r.values).catch(() => null);
    if (!preview) return;
    // Nothing archived or deleted by this change: no need to ask twice.
    if (!hasImpact(preview)) return save.mutate(r.values);
    setPending({ values: r.values, preview });
  };

  const itemName = t(`items.${item.id}.title`);
  const fieldError = problem
    ? t(`validation.${problem}`, {
        min: problem === 'archive_out_of_range' ? item.limits.archive.min : item.limits.live.min,
        max: problem === 'archive_out_of_range' ? item.limits.archive.max : item.limits.live.max,
      })
    : undefined;
  const run = item.lastRun;

  return (
    <Card
      className="scroll-mt-20 space-y-4"
      id={`retention-${item.id}`}
      data-testid={`retention-${item.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{itemName}</h3>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t(`items.${item.id}.description`)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={item.source === 'custom' ? 'success' : 'neutral'}>
            {t(`status.${item.source}`)}
          </Badge>
          {!item.applied && <Badge tone="warning">{t('status.notApplied')}</Badge>}
          {item.updatedAt && (
            <span className="text-xs text-muted-foreground">
              {t('status.updated', { when: when(item.updatedAt) })}
            </span>
          )}
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('fields.liveDays')}
            htmlFor={`${id}-live`}
            hint={t('fields.liveDaysHint', item.limits.live)}
            error={
              problem === 'live_out_of_range' ||
              (problem === 'not_a_number' && !draft.liveDays.match(/^\d+$/))
                ? fieldError
                : undefined
            }
          >
            <Input
              id={`${id}-live`}
              type="number"
              inputMode="numeric"
              min={item.limits.live.min}
              max={item.limits.live.max}
              value={draft.liveDays}
              invalid={problem === 'live_out_of_range'}
              disabled={!canEdit}
              onChange={(e) => set({ liveDays: e.target.value })}
            />
          </Field>
          {item.canArchive && (
            <div className="space-y-3">
              <Field
                label={t('fields.archiveDays')}
                htmlFor={`${id}-archive`}
                hint={t('fields.archiveDaysHint', item.limits.archive)}
                error={problem === 'archive_out_of_range' ? fieldError : undefined}
              >
                <Input
                  id={`${id}-archive`}
                  type="number"
                  inputMode="numeric"
                  min={item.limits.archive.min}
                  max={item.limits.archive.max}
                  value={draft.archiveDays}
                  invalid={problem === 'archive_out_of_range'}
                  disabled={!canEdit || draft.keepForever}
                  onChange={(e) => set({ archiveDays: e.target.value })}
                />
              </Field>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <span className="text-sm font-medium">{t('fields.keepForever')}</span>
                <Switch
                  checked={draft.keepForever}
                  label={t('fields.keepForever')}
                  disabled={!canEdit}
                  onCheckedChange={(keepForever) => set({ keepForever })}
                />
              </div>
            </div>
          )}
        </div>
        {problem === 'not_a_number' && (
          <p role="alert" className="text-xs text-danger">
            {t('validation.not_a_number')}
          </p>
        )}

        <p className="text-sm" data-testid={`retention-summary-${item.id}`}>
          {item.source === 'default' && item.liveDays === 0 && !changed
            ? t('summary.defaultForever')
            : t(`summary.${summary.kind}`, {
                live: summary.live,
                archive: summary.archive ?? 0,
                total: summary.total ?? 0,
              })}
        </p>

        {canEdit && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            {item.source === 'custom' && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setResetting(true)}
                disabled={reset.isPending}
              >
                {t('actions.reset')}
              </Button>
            )}
            <Button type="submit" disabled={!changed || check.isPending || save.isPending}>
              {check.isPending
                ? t('actions.checking')
                : save.isPending
                  ? t('actions.saving')
                  : t('actions.save')}
            </Button>
          </div>
        )}
      </form>

      <dl className="grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('stats.live')}</dt>
          <dd data-testid={`retention-live-${item.id}`}>
            {item.live.rows === null
              ? t('stats.liveValueNoRows', { size: formatBytes(item.live.bytes) })
              : t('stats.liveValue', {
                  size: formatBytes(item.live.bytes),
                  rows: f.number(item.live.rows),
                })}
            {item.live.partitions !== null && item.live.oldestMonth && (
              <span className="block text-xs text-muted-foreground">
                {t('stats.months', { count: item.live.partitions, oldest: item.live.oldestMonth })}
              </span>
            )}
          </dd>
        </div>
        {item.canArchive && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t('stats.archive')}</dt>
            <dd data-testid={`retention-archive-${item.id}`}>
              {item.archive ? (
                <>
                  {t('stats.archiveValue', {
                    size: formatBytes(item.archive.bytes),
                    count: item.archive.objects,
                  })}
                  <span className="block text-xs text-muted-foreground">
                    {t('stats.archiveMeasured', { when: when(item.archive.measuredAt) })}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">{t('stats.archiveNone')}</span>
              )}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('stats.lastRun')}</dt>
          <dd data-testid={`retention-run-${item.id}`}>
            {run ? (
              run.mode === 'dry_run' ? (
                t('stats.runDry', { when: when(run.at) })
              ) : item.kind === 'table' || item.kind === 'file' ? (
                t('stats.runDeleted', { when: when(run.at), deleted: f.number(run.deletedRows) })
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
              <span className="block text-xs text-danger">
                {t('stats.runFailed', { error: run.error })}
              </span>
            )}
          </dd>
        </div>
      </dl>

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
                      size: formatBytes(pending.preview.toArchive.reduce((n, m) => n + m.bytes, 0)),
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
                  <li>{t('preview.rowsToDelete', { count: pending.preview.rowsToDelete ?? 0 })}</li>
                )}
              </ul>
              {!item.applied && <Alert tone="warning">{t('preview.notApplied')}</Alert>}
              {(pending.preview.toDeleteFromArchive.length > 0 ||
                (pending.preview.rowsToDelete ?? 0) > 0) && (
                <p className="font-medium">{t('preview.permanent')}</p>
              )}
            </div>
          )
        }
        confirmLabel={t('actions.confirmSave')}
        cancelLabel={t('actions.cancel')}
        tone={
          pending &&
          (pending.preview.toDeleteFromArchive.length > 0 ||
            (pending.preview.rowsToDelete ?? 0) > 0)
            ? 'danger'
            : 'default'
        }
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
    </Card>
  );
}
