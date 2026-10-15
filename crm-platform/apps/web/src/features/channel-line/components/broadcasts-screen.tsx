'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog, StatTile, useToast } from '@crm/ui';
import type { LineBroadcast } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  deleteBroadcast,
  KEYS,
  pauseBroadcast,
  retryBroadcast,
  startBroadcast,
  useChannels,
  useLineBroadcasts,
} from '../api/line';
import { LINE_GREEN, LineGlyph, PauseIcon, PlusIcon, TrashIcon } from './line-icons';

const n = (v: number | undefined) => (v ?? 0).toLocaleString();
const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const PILL: Record<LineBroadcast['status'], string> = {
  sending: 'bg-warning/15 text-warning',
  done: 'bg-success/10 text-success',
  failed: 'bg-danger/10 text-danger',
  draft: 'bg-muted text-muted-foreground',
};
const pillLink =
  'inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted';

/**
 * `/line/broadcasts`: the five tiles, the recent broadcasts with live progress, and Start, Pause, Retry and Delete. A worker sends the
 * broadcast, so closing this page no longer stops it; "Pause" replaces Reference's "Resume".
 */
export function BroadcastsScreen() {
  const t = useTranslations('line.broadcasts');
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('line.broadcasts.manage');
  const channels = useChannels();
  const list = useLineBroadcasts();
  const [pendingDelete, setPendingDelete] = useState<LineBroadcast | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const noChannels = channels.isSuccess && channels.data.data.length === 0;
  const stats = list.data?.stats;
  const rows = list.data?.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.broadcasts });

  const act = async (id: string, action: () => Promise<unknown>, ok: string | (() => string)) => {
    setBusy(id);
    try {
      await action();
      toast(typeof ok === 'function' ? ok() : ok, 'success');
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const retry = (b: LineBroadcast) => {
    let retried = 0;
    return act(
      b.id,
      async () => {
        retried = (await retryBroadcast(b.id)).retried;
      },
      () => t('retried', { count: retried }),
    );
  };

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
            {t('title')}{' '}
            <span className="italic" style={{ color: LINE_GREEN }}>
              {t('titleAccent')}
            </span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/line" className={pillLink}>
            {t('channels')}
          </Link>
          {canManage && !noChannels && (
            <Link
              href="/line/broadcasts/create"
              className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs font-semibold text-white"
              style={{ background: LINE_GREEN }}
            >
              <PlusIcon className="size-3.5" />
              {t('newBroadcast')}
            </Link>
          )}
        </div>
      </div>

      {noChannels ? (
        <div className="rounded-2xl border border-border bg-background p-10 text-center shadow-sm">
          <span
            className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl text-white"
            style={{ background: LINE_GREEN }}
          >
            <LineGlyph className="size-6" />
          </span>
          <p className="text-sm">{t('connectFirst')}</p>
          <Link
            href="/line"
            className="mt-3 inline-flex h-9 items-center rounded-full px-4 text-xs font-semibold text-white"
            style={{ background: LINE_GREEN }}
          >
            {t('connectChannel')}
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile
              label={t('tile.sent')}
              value={n(stats?.sent)}
              hint={t('tile.broadcasts', { count: n(stats?.total) })}
              tone="accent"
            />
            <StatTile
              label={t('tile.audience')}
              value={n(stats?.audience)}
              hint={t('tile.audienceHint')}
              tone="accent"
            />
            <StatTile
              label={t('tile.failed')}
              value={n(stats?.failed)}
              hint={t('tile.failedHint')}
            />
            <StatTile
              label={t('tile.blocked')}
              value={n(stats?.blocked)}
              hint={t('tile.blockedHint')}
            />
            <StatTile
              label={t('tile.sending')}
              value={n(stats?.sending)}
              hint={t('tile.sendingHint')}
              tone="warning"
            />
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="border-b border-border px-5 py-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('listKicker')}
              </div>
              <h2 className="mt-0.5 text-2xl leading-tight">{t('listTitle')}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-start text-muted-foreground">
                    {(['broadcast', 'channel', 'recipients', 'progress', 'status'] as const).map(
                      (k) => (
                        <th
                          key={k}
                          className={`px-5 py-2.5 font-mono text-[10px] uppercase tracking-wide ${k === 'recipients' ? 'text-end' : 'text-start'}`}
                        >
                          {t(`col.${k}`)}
                        </th>
                      ),
                    )}
                    <th className="px-5 py-2.5 text-end font-mono text-[10px] uppercase tracking-wide">
                      {t('col.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr
                      key={b.id}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-5 py-3">
                        <div className="font-semibold">{b.name}</div>
                        <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                          {new Date(b.createdAt).toLocaleString()}
                        </div>
                        {b.status === 'failed' && b.lastError && (
                          <div className="mt-0.5 text-[10.5px] text-danger">{b.lastError}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-[11.5px] text-muted-foreground">
                        {b.channelName || '—'}
                      </td>
                      <td className="px-5 py-3 text-end font-mono">{n(b.total)}</td>
                      <td className="min-w-[160px] px-5 py-3">
                        <div
                          className="h-1.5 overflow-hidden rounded-full bg-muted"
                          role="progressbar"
                          aria-valuenow={b.progress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${b.progress}%`, background: LINE_GREEN }}
                          />
                        </div>
                        <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                          {t('counts', { sent: b.sent, failed: b.failed, blocked: b.blocked })}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 font-mono text-[10.5px] ${PILL[b.status]}`}
                        >
                          {t(`status.${b.status}`)}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {canManage && (
                          <div className="flex items-center justify-end gap-1.5">
                            {b.status === 'draft' && (
                              <Button
                                size="sm"
                                className="rounded-full text-white"
                                style={{ background: LINE_GREEN }}
                                disabled={busy === b.id}
                                onClick={() =>
                                  void act(b.id, () => startBroadcast(b.id), t('started'))
                                }
                              >
                                {t('start')}
                              </Button>
                            )}
                            {b.status === 'sending' && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="rounded-full"
                                disabled={busy === b.id}
                                onClick={() =>
                                  void act(b.id, () => pauseBroadcast(b.id), t('paused'))
                                }
                              >
                                <PauseIcon className="size-3" />
                                {t('pause')}
                              </Button>
                            )}
                            {(b.status === 'failed' ||
                              ((b.failed > 0 || b.blocked > 0) && b.status === 'done')) && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="rounded-full"
                                disabled={busy === b.id}
                                onClick={() => void retry(b)}
                              >
                                {t('retry')}
                              </Button>
                            )}
                            <button
                              type="button"
                              className="grid size-7 place-items-center rounded-lg text-danger hover:bg-danger/10"
                              aria-label={t('delete')}
                              title={t('delete')}
                              onClick={() => setPendingDelete(b)}
                            >
                              <TrashIcon className="size-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && !list.isLoading && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-12 text-center text-sm text-muted-foreground"
                      >
                        {t('empty')}{' '}
                        {canManage && (
                          <Link
                            href="/line/broadcasts/create"
                            className="font-semibold hover:underline"
                            style={{ color: LINE_GREEN }}
                          >
                            {t('createFirst')}
                          </Link>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        tone="danger"
        busy={busy !== null}
        title={t('delete')}
        message={t('deleteConfirm')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const b = pendingDelete;
          setPendingDelete(null);
          if (b) void act(b.id, () => deleteBroadcast(b.id), t('deleted'));
        }}
      />
    </main>
  );
}
