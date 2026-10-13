'use client';

import { useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button, Spinner, cn } from '@crm/ui';
import { importFromMeta, pollBatches, syncProducts } from '../api/catalog';
import { pushLog, runSyncLoop, type LogLine, type SyncCounts } from '../lib/sync-model';
import { ImportIcon, PollIcon, SyncIcon } from './icons';
import { CARD } from './parts';
import { useErrorText } from './use-error-text';

type Busy = 'sync' | 'poll' | 'import' | null;

/**
 * The sync bar and its progress panel (TW-CAT-009, 010, 011): "Sync to Meta" posts chunks while the server says there is
 * more, "Refresh status" polls the batches, "Import from Meta" pulls the catalog down. The log lists the newest line first.
 */
export function SyncPanel({
  waiting,
  canManage,
  onCounts,
  onChanged,
}: {
  /** Products never pushed plus failed ones. */
  waiting: number;
  canManage: boolean;
  /** The live Synced / Pending / Failed counts after a chunk. */
  onCounts: (counts: SyncCounts) => void;
  /** Something changed on the server: re-read the overview. */
  onChanged: () => void;
}) {
  const t = useTranslations('catalogProducts.sync');
  const timeZone = useTimeZone();
  const errorText = useErrorText();
  const [busy, setBusy] = useState<Busy>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [percent, setPercent] = useState(0);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const add = (tone: LogLine['tone'], text: string) =>
    setLog((l) =>
      pushLog(l, { at: new Date().toLocaleTimeString(undefined, { timeZone }), tone, text }),
    );
  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const sync = async () => {
    setBusy('sync');
    setPercent(0);
    add('info', t('starting'));
    const out = await runSyncLoop(syncProducts, {
      onChunk: (res, pct) => {
        add(
          'info',
          t('pushed', {
            pushed: res.pushed,
            pending: res.totalPending,
            synced: res.totalSynced,
            failed: res.totalFailed,
          }),
        );
        onCounts({ synced: res.totalSynced, pending: res.totalPending, failed: res.totalFailed });
        setPercent(pct);
      },
    });
    if (out.error) add('error', errorText(out.error));
    else if (out.stalled) add('error', t('stalled'));
    add(out.error || out.stalled ? 'info' : 'ok', t('done', { count: out.total }));
    setBusy(null);
    onChanged();
  };

  const poll = async () => {
    setBusy('poll');
    try {
      const res = await pollBatches();
      add('info', t('polled', { synced: res.synced, failed: res.failed }));
      if (res.synced > 0 || res.failed > 0) later(600, onChanged);
    } catch (e) {
      add('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const importAll = async () => {
    setBusy('import');
    add('info', t('importStarting'));
    try {
      const res = await importFromMeta();
      add(
        'ok',
        t('imported', {
          imported: res.imported,
          updated: res.updated,
          skipped: res.skipped,
          total: res.total,
        }),
      );
      later(900, onChanged);
    } catch (e) {
      add('error', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <section className={cn(CARD, 'flex flex-wrap items-center gap-3 p-4')}>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-[16px] font-normal leading-tight">{t('title')}</h3>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {t('intro', { count: waiting })}
          </p>
        </div>
        {canManage && (
          <>
            <Button
              variant="brand"
              className="rounded-full px-4"
              disabled={busy !== null}
              onClick={() => void sync()}
            >
              {busy === 'sync' ? <Spinner /> : <SyncIcon className="size-3" />}
              {busy === 'sync' ? t('syncing') : t('syncButton')}
            </Button>
            <Button
              variant="secondary"
              className="rounded-full px-4"
              disabled={busy !== null}
              onClick={() => void poll()}
            >
              {busy === 'poll' ? <Spinner /> : <PollIcon className="size-3" />}
              {busy === 'poll' ? t('polling') : t('pollButton')}
            </Button>
            <Button
              variant="secondary"
              className="rounded-full px-4"
              disabled={busy !== null}
              title={t('importHint')}
              onClick={() => void importAll()}
            >
              {busy === 'import' ? <Spinner /> : <ImportIcon className="size-3" />}
              {busy === 'import' ? t('importing') : t('importButton')}
            </Button>
          </>
        )}
      </section>
      {log.length > 0 && (
        <section className={cn(CARD, 'p-4')} aria-label={t('progress')}>
          <ul
            aria-live="polite"
            className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-[10.5px]"
          >
            {log.map((l) => (
              <li
                key={l.id}
                className={cn(
                  l.tone === 'error' && 'text-danger',
                  l.tone === 'ok' && 'text-brand dark:text-primary',
                )}
              >
                {l.tone === 'error' ? '✗ ' : l.tone === 'ok' ? '✓ ' : ''}
                {l.at} · {l.text}
              </li>
            ))}
          </ul>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-label={t('progress')}
            className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-brand transition-all" style={{ width: `${percent}%` }} />
          </div>
        </section>
      )}
    </>
  );
}
