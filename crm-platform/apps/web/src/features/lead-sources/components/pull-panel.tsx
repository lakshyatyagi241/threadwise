'use client';

import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BackfillLeadsResponse, LeadPullSource, LeadSyncRun } from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, Field, Input, Modal, Spinner, useToast } from '@crm/ui';
import { leadKeys } from '../api';
import { backfillSources, opsKeys, syncSourceNow, usePullSources, useRuns } from '../api-ops';
import { leadError } from '../lib/errors';
import {
  BACKFILL_MAX_DAYS,
  RUN_TONE,
  backfillBody,
  backfillProblems,
  isOpenRun,
  knownRunError,
  runPercent,
  type BackfillDraft,
} from '../lib/inbox-view';
import type { LeadsCan } from '../lib/permissions';
import { sourceHref } from '../lib/source-view';
import { ErrorText, When } from './ui';

/**
 * "Sync now" and backfill for the sources that can be pulled (BL-014, L-18). Shown only when a source can: a webhook sends its own leads,
 * so a workspace with only webhooks sees nothing here. A run goes to a worker; this panel asks again every few seconds while one is
 * queued or running and shows how far it is. The limits are the server's (one run at a time per source, the source's own rate limit,
 * ten minutes between backfills): a refusal says so in words and, for "too soon", how long to wait.
 */
export function PullPanel({ can }: { can: LeadsCan }) {
  const t = useTranslations('lead-sources.inbox.pull');
  const sources = usePullSources(can.read, true);
  const runs = useRuns(can.read && (sources.data?.data.length ?? 0) > 0);
  const [backfillOpen, setBackfillOpen] = useState(false);

  const list = sources.data?.data ?? [];
  if (list.length === 0) return null;
  const canBackfill = list.some((s) => s.canBackfill);

  return (
    <section aria-labelledby="li-pull-h" className="space-y-3" data-testid="pull-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 id="li-pull-h" className="text-base font-semibold">
            {t('title')}
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {can.manage && canBackfill && (
          <Button type="button" variant="secondary" onClick={() => setBackfillOpen(true)}>
            {t('backfill')}
          </Button>
        )}
      </div>

      <ul className="grid gap-3 lg:grid-cols-2">
        {list.map((s) => (
          <li key={s.sourceId}>
            <PullSourceCard source={s} canManage={can.manage} />
          </li>
        ))}
      </ul>

      {runs.data && runs.data.data.length > 0 && (
        <details className="rounded-md border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t('history')}</summary>
          <ul className="divide-y divide-border">
            {runs.data.data.map((r) => (
              <li key={r.id} className="px-3 py-2">
                <RunLine run={r} withSource />
              </li>
            ))}
          </ul>
        </details>
      )}

      {can.manage && (
        <BackfillDialog open={backfillOpen} sources={list} onClose={() => setBackfillOpen(false)} />
      )}
    </section>
  );
}

function PullSourceCard({ source: s, canManage }: { source: LeadPullSource; canManage: boolean }) {
  const t = useTranslations('lead-sources.inbox.pull');
  const qc = useQueryClient();
  const { toast } = useToast();
  const sync = useMutation({
    mutationFn: () => syncSourceNow(s.sourceId),
    onSuccess: () => {
      toast(t('syncStarted', { name: s.sourceName }));
      void qc.invalidateQueries({ queryKey: opsKeys.pullSources });
      void qc.invalidateQueries({ queryKey: opsKeys.runs });
    },
  });
  const run = s.activeRun ?? s.lastRun;
  const busy = s.activeRun !== null;
  const paused = s.sourceStatus !== 'active';

  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid="pull-source">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={sourceHref(s.sourceId)}
          dir="auto"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {s.sourceName}
        </Link>
        {canManage && s.canSync && (
          <Button
            type="button"
            size="sm"
            disabled={busy || paused || sync.isPending}
            onClick={() => sync.mutate()}
          >
            {(busy || sync.isPending) && <Spinner />}
            {t('syncNow')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {paused
          ? t('paused')
          : s.nextSyncAt
            ? t('nextSync')
            : t('syncReady', { seconds: s.minIntervalSeconds })}
        {s.nextSyncAt && (
          <>
            {' '}
            <When value={s.nextSyncAt} empty="" />
          </>
        )}
        {s.canBackfill && s.maxBackfillDays ? ` ${t('reach', { days: s.maxBackfillDays })}` : ''}
      </p>
      {run ? <RunLine run={run} /> : <p className="text-xs text-muted-foreground">{t('never')}</p>}
      {sync.isError && <ErrorText mapped={leadError(sync.error)} />}
    </div>
  );
}

/** One run: what it is, how far it is, what it fetched, and when. */
export function RunLine({ run, withSource = false }: { run: LeadSyncRun; withSource?: boolean }) {
  const t = useTranslations('lead-sources.inbox.pull');
  const error = knownRunError(run.error);
  const percent = runPercent(run);
  return (
    <div className="space-y-1" data-testid="sync-run" data-status={run.status}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {withSource && <span dir="auto">{run.sourceName}</span>}
        <span>{t(`kinds.${run.kind}`)}</span>
        <Badge tone={RUN_TONE[run.status]}>{t(`statuses.${run.status}`)}</Badge>
        {error && <span className="text-xs text-muted-foreground">{t(`errors.${error}`)}</span>}
        <span className="text-xs text-muted-foreground">
          <When value={run.finishedAt ?? run.startedAt ?? run.requestedAt} empty="" />
        </span>
      </div>
      {run.kind === 'backfill' && run.rangeFrom && run.rangeTo && (
        <p className="text-xs text-muted-foreground" dir="ltr">
          {run.rangeFrom.slice(0, 10)} - {run.rangeTo.slice(0, 10)}
        </p>
      )}
      {(isOpenRun(run) || run.windowsTotal > 1) && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={t('progress', { percent })}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}
      {run.status !== 'queued' && (
        <p className="text-xs text-muted-foreground">
          {t('counts', {
            fetched: run.fetched,
            accepted: run.accepted,
            duplicates: run.duplicates,
            failed: run.failed,
          })}
        </p>
      )}
    </div>
  );
}

export function BackfillDialog({
  open,
  sources,
  onClose,
}: {
  open: boolean;
  sources: LeadPullSource[];
  onClose: () => void;
}) {
  const t = useTranslations('lead-sources.inbox.backfill');
  const tp = useTranslations('lead-sources.inbox.pull');
  const qc = useQueryClient();
  const { toast } = useToast();
  const able = sources.filter((s) => s.canBackfill && s.sourceStatus === 'active');
  const [draft, setDraft] = useState<BackfillDraft>({ from: '', to: '', sourceIds: [] });
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<BackfillLeadsResponse | null>(null);

  const go = useMutation({
    mutationFn: () => backfillSources(backfillBody(draft, new Date())),
    onSuccess: (res) => {
      setResult(res);
      if (res.runs.length > 0) toast(t('started', { count: res.runs.length }));
      void qc.invalidateQueries({ queryKey: opsKeys.pullSources });
      void qc.invalidateQueries({ queryKey: opsKeys.runs });
      void qc.invalidateQueries({ queryKey: leadKeys.list });
    },
  });
  const problem = backfillProblems(draft, new Date());
  const ticked = (id: string) => draft.sourceIds.includes(id);
  const close = () => {
    setResult(null);
    setShow(false);
    go.reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('title')}
      size="md"
      closeLabel={t('close')}
      footer={
        result ? (
          <Button type="button" onClick={close}>
            {t('done')}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              disabled={go.isPending}
              onClick={() => {
                setShow(true);
                if (problem === null) go.mutate();
              }}
            >
              {go.isPending && <Spinner />}
              {t('submit')}
            </Button>
            <Button type="button" variant="secondary" onClick={close}>
              {t('cancel')}
            </Button>
          </>
        )
      }
    >
      {open && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('intro', { days: BACKFILL_MAX_DAYS })}</p>
          {result ? (
            <div className="space-y-2" data-testid="backfill-result">
              {result.runs.map((r) => (
                <RunLine key={r.id} run={r} withSource />
              ))}
              {result.skipped.length > 0 && (
                <Alert tone="warning" className="space-y-1">
                  <p>{t('skippedTitle')}</p>
                  <ul className="list-disc ps-5 text-xs">
                    {result.skipped.map((s) => (
                      <li key={s.sourceId}>
                        {sources.find((x) => x.sourceId === s.sourceId)?.sourceName ?? s.sourceId}:{' '}
                        {t(`skipped.${s.reason}`)}
                      </li>
                    ))}
                  </ul>
                </Alert>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('from')} htmlFor="bf-from">
                  <Input
                    id="bf-from"
                    type="date"
                    dir="ltr"
                    value={draft.from}
                    onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                  />
                </Field>
                <Field label={t('to')} htmlFor="bf-to">
                  <Input
                    id="bf-to"
                    type="date"
                    dir="ltr"
                    value={draft.to}
                    onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                  />
                </Field>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t('sources')}</legend>
                {able.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noSources')}</p>
                ) : (
                  able.map((s) => (
                    <Checkbox
                      key={s.sourceId}
                      id={`bf-${s.sourceId}`}
                      checked={ticked(s.sourceId)}
                      onChange={() =>
                        setDraft((d) => ({
                          ...d,
                          sourceIds: ticked(s.sourceId)
                            ? d.sourceIds.filter((x) => x !== s.sourceId)
                            : [...d.sourceIds, s.sourceId],
                        }))
                      }
                      label={
                        <span>
                          {s.sourceName}{' '}
                          <span className="text-xs text-muted-foreground">
                            {tp('reach', { days: s.maxBackfillDays ?? 0 })}
                          </span>
                        </span>
                      }
                    />
                  ))
                )}
              </fieldset>
              {show && problem && (
                <Alert tone="warning">
                  {t(`problems.${problem}`, { days: BACKFILL_MAX_DAYS })}
                </Alert>
              )}
              {go.isError && <ErrorText mapped={leadError(go.error)} />}
              <Alert tone="info" className="text-xs" data-testid="backfill-speed-note">
                {t('speedNote')}
              </Alert>
              <p className="text-xs text-muted-foreground">{t('safe')}</p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
