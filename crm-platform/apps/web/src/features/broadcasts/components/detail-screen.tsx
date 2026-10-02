'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, ConfirmDialog, EmptyState, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { deleteBroadcast, KEYS } from '../api/broadcasts';
import {
  detailKey,
  resumeBroadcast,
  retryFailed,
  useBroadcastDetail,
  useBroadcastLive,
} from '../api/detail';
import { formatCreated, parseTab, pillTone, TABS, tiles, type Tab } from '../lib/detail-model';
import { canDelete, providerLabel, reference, statusLabel } from '../lib/list-model';
import { ChevronLeftIcon, RefreshIcon, TrashIcon } from './icons';
import { EventsTab } from './events-tab';
import { FailuresTab } from './failures-tab';
import { OverviewTab } from './overview-tab';
import { RecipientsTab } from './recipients-tab';

const PILL: Record<ReturnType<typeof pillTone>, string> = {
  success: 'border-success/30 bg-success/15 text-success',
  warning: 'border-warning/30 bg-warning/15 text-foreground',
  danger: 'border-danger/30 bg-danger/15 text-danger',
  neutral: 'border-border bg-muted text-muted-foreground',
};

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'accent' | 'danger';
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3',
        tone === 'accent' && 'border-success/30 bg-success/10',
        tone === 'danger' && 'border-danger/30 bg-muted/50',
        !tone && 'border-border bg-muted/50',
      )}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-[28px] leading-none tabular-nums',
          tone === 'accent' && 'text-brand',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value.toLocaleString()}
      </div>
      {hint && (
        <div
          className={cn(
            'mt-1 text-[10px]',
            tone === 'danger' ? 'text-danger' : 'text-muted-foreground',
          )}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

/**
 * `/broadcasts/:id` (TW-BCAST-030): the header with the status, retry, resume and delete; the six live tiles; and the four tabs.
 * The tab is in the address (`?tab=`). The tiles follow the worker every 12 seconds while the broadcast is in flight.
 */
export function BroadcastDetailScreen({ id }: { id: string }) {
  const t = useTranslations('broadcasts.detail');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canRetry = useCan('bcast.broadcasts.retry');
  const canResume = useCan('bcast.broadcasts.resume');
  const canDeleteIt = useCan('bcast.broadcasts.delete');
  const canExport = useCan('bcast.broadcasts.export');

  const tab = parseTab(search.get('tab'));
  const setTab = (next: Tab) => {
    const p = new URLSearchParams(search.toString());
    if (next === 'overview') p.delete('tab');
    else p.set('tab', next);
    const s = p.toString();
    router.replace(`${pathname}${s ? `?${s}` : ''}`, { scroll: false });
  };

  const detail = useBroadcastDetail(id);
  const live = useBroadcastLive(id, detail.isSuccess);
  const [confirm, setConfirm] = useState<'retry' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);

  // When the live status moves on (processing to completed, a retry, a pause), the charts and tabs are stale: load them again.
  const liveStatus = live.data?.status;
  const shownStatus = detail.data?.broadcast.status;
  useEffect(() => {
    if (liveStatus && shownStatus && liveStatus !== shownStatus) {
      void qc.invalidateQueries({ queryKey: KEYS.all });
    }
  }, [liveStatus, shownStatus, qc]);

  if (detail.isPending) {
    return (
      <div className="flex justify-center p-16">
        <Spinner label={t('loading')} />
      </div>
    );
  }
  if (detail.isError) {
    const gone = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="mx-auto max-w-xl p-8">
        <EmptyState
          title={gone ? t('notFound') : t('loadError')}
          message={gone ? t('notFoundBody') : message(detail.error, '')}
          actions={
            gone ? (
              <Link
                href="/broadcasts"
                className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
              >
                {t('backToList')}
              </Link>
            ) : (
              <Button variant="secondary" onClick={() => void detail.refetch()}>
                {t('tryAgain')}
              </Button>
            )
          }
        />
      </div>
    );
  }

  const d = detail.data;
  const b = d.broadcast;
  const status = liveStatus ?? b.status;
  const c = live.data
    ? tiles({
        total: live.data.total,
        sent: live.data.sent,
        delivered: live.data.delivered,
        read: live.data.read,
        failed: live.data.failed,
        queued: live.data.queued,
      })
    : tiles(d.counts);
  const failed = c.failed;
  const refresh = () => void qc.invalidateQueries({ queryKey: KEYS.all });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(message(e, t('loadError')), 'danger');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const doRetry = () =>
    run(async () => {
      const r = await retryFailed(id);
      toast(r.retried > 0 ? t('retrySubmitted') : t('retryNone'), 'success');
      refresh();
    });
  const doDelete = () =>
    run(async () => {
      await deleteBroadcast(id);
      toast(t('deleted'), 'success');
      router.replace('/broadcasts');
    });
  const doResume = () =>
    run(async () => {
      await resumeBroadcast(id);
      toast(t('resumed'), 'success');
      void qc.invalidateQueries({ queryKey: detailKey(id) });
      refresh();
    });

  const pause = status === 'paused' ? d.pause : null;
  const tabLabel = (k: Tab) => (
    <>
      {t(`tab.${k}`)}
      {k === 'recipients' && (
        <span className="ms-1 font-mono text-[10px] text-muted-foreground">
          {c.total.toLocaleString()}
        </span>
      )}
      {k === 'failures' && (
        <span className="ms-1 font-mono text-[10px] text-muted-foreground">
          {failed.toLocaleString()}
        </span>
      )}
    </>
  );

  return (
    <>
      <div className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex max-w-none flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/broadcasts"
              title={t('back')}
              aria-label={t('back')}
              className="grid size-8 place-items-center rounded-full border border-border hover:bg-muted"
            >
              <ChevronLeftIcon className="size-3.5 rtl:rotate-180" />
            </Link>
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('crumb', { ref: reference(b.id) })}
              </div>
              <div className="truncate text-xl leading-tight">{b.name}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                PILL[pillTone(status)],
              )}
            >
              {statusLabel(status) || t('draft')}
            </span>
            {canRetry && failed > 0 && (
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full"
                title={t('retryHint')}
                disabled={busy}
                onClick={() => setConfirm('retry')}
              >
                <RefreshIcon className="size-3" />
                {t('retry')} ({failed.toLocaleString()})
              </Button>
            )}
            {canResume && status === 'paused' && (
              <Button
                size="sm"
                className="rounded-full"
                title={t('resumeHint')}
                disabled={busy}
                onClick={() => void doResume()}
              >
                {t('resume')}
              </Button>
            )}
            {canDeleteIt && canDelete(status) && (
              <Button
                variant="danger"
                size="sm"
                className="rounded-full"
                disabled={busy}
                onClick={() => setConfirm('delete')}
              >
                <TrashIcon className="size-3" />
                {t('delete')}
              </Button>
            )}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-none space-y-5 px-4 py-6 sm:px-6 lg:px-7">
        {pause && (
          <Alert tone="warning">
            {t(`paused.${pause.reason}`, {
              when: pause.resumeAfter ? formatCreated(pause.resumeAfter, b.timezone) : '',
            })}
          </Alert>
        )}
        <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-5 border-b border-border px-6 py-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                <span>{t('kicker')}</span>
                {b.provider && providerLabel(b.provider) !== '—' && (
                  <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider">
                    {providerLabel(b.provider)}
                  </span>
                )}
                <span className="size-1 rounded-full bg-muted-foreground" aria-hidden="true" />
                <span>{formatCreated(b.createdAt, b.timezone)}</span>
                {d.sender && (d.sender.label || d.sender.phone) && (
                  <>
                    <span className="size-1 rounded-full bg-muted-foreground" aria-hidden="true" />
                    <span>
                      {d.sender.label} · {d.sender.phone}
                    </span>
                  </>
                )}
              </div>
              <h1 className="mt-2 text-3xl leading-none lg:text-[40px]">{t('title')}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
            </div>
            <div
              className="grid w-full max-w-[480px] grid-cols-2 gap-2 sm:grid-cols-3"
              aria-live="polite"
            >
              <Tile
                tone="accent"
                label={t('tile.sent')}
                value={c.sent}
                hint={t('tile.sentPct', { pct: c.pct.sent })}
              />
              <Tile
                label={t('tile.delivered')}
                value={c.delivered}
                hint={t('tile.deliveredPct', { pct: c.pct.delivered })}
              />
              <Tile
                label={t('tile.read')}
                value={c.read}
                hint={t('tile.readPct', { pct: c.pct.read })}
              />
              <Tile label={t('tile.audience')} value={c.total} hint={t('tile.audienceHint')} />
              <Tile label={t('tile.queued')} value={c.queued} hint={t('tile.queuedHint')} />
              <Tile
                tone="danger"
                label={t('tile.failed')}
                value={c.failed}
                hint={t('tile.failedPct', { pct: c.pct.failed })}
              />
            </div>
          </div>
          <div
            role="tablist"
            className="flex items-center gap-1 overflow-x-auto border-b border-border px-6 py-3"
          >
            {TABS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  'rounded-full px-4 py-2 text-[13px] font-semibold transition',
                  tab === k
                    ? 'bg-brand text-brand-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {tabLabel(k)}
              </button>
            ))}
          </div>
        </section>

        <div role="tabpanel">
          {tab === 'overview' && <OverviewTab detail={d} />}
          {tab === 'recipients' && (
            <RecipientsTab id={id} timezone={b.timezone} canExport={canExport} />
          )}
          {tab === 'failures' && <FailuresTab id={id} detail={d} />}
          {tab === 'events' && <EventsTab detail={d} />}
        </div>
      </main>

      <ConfirmDialog
        open={confirm === 'retry'}
        title={t('retryTitle')}
        message={t('retryBody')}
        confirmLabel={t('retryConfirm')}
        cancelLabel={t('cancel')}
        busy={busy}
        onConfirm={() => void doRetry()}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title={t('deleteTitle')}
        message={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => void doDelete()}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
