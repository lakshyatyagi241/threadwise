'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, ConfirmDialog, Spinner, useToast } from '@crm/ui';
import type { WechatBroadcast } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import {
  deleteBroadcast,
  KEYS,
  retryBroadcast,
  startBroadcast,
  useBroadcasts,
  useCompose,
} from '../api/wechat';
import { audienceLabel, rowAction } from '../lib/broadcast-model';
import { PlusIcon, TrashIcon, WECHAT_GREEN, WechatBadge } from './wechat-icons';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const PILL: Record<WechatBroadcast['status'], string> = {
  sending: 'bg-warning/15 text-warning',
  done: 'bg-success/10 text-success',
  failed: 'bg-danger/10 text-danger',
  draft: 'bg-muted text-muted-foreground',
};
const pillLink =
  'inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted';

/**
 * `/wechat/broadcasts`: the recent broadcasts with their audience and status, Send and Delete. A mass send is one WeChat call made by
 * a worker job, so a row goes Draft, Sending, then Sent or Failed on its own; there is no progress to follow.
 */
export function BroadcastsScreen() {
  const t = useTranslations('wechat.broadcasts');
  // The quiet-hours wording is shared with the other senders (BL-177); it lives with the Compliance center.
  const tHold = useTranslations('compliance-center.hold');
  const qc = useQueryClient();
  const { toast } = useToast();
  const canManage = useCan('wechat.broadcasts.manage');
  const canChannels = useCan('wechat.channels.read');
  const compose = useCompose();
  const list = useBroadcasts();
  const [pendingSend, setPendingSend] = useState<WechatBroadcast | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WechatBroadcast | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const noChannels = compose.isSuccess && compose.data.channels.length === 0;
  const rows = list.data?.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.broadcasts });

  const act = async (id: string, action: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    try {
      await action();
      toast(ok, 'success');
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(null);
      await refresh();
    }
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
            <span className="italic" style={{ color: WECHAT_GREEN }}>
              {t('titleAccent')}
            </span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canChannels && (
            <Link href="/wechat" className={pillLink}>
              {t('channels')}
            </Link>
          )}
          {canManage && !noChannels && (
            <Link
              href="/wechat/broadcasts/create"
              className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs font-semibold text-white"
              style={{ background: WECHAT_GREEN }}
            >
              <PlusIcon className="size-3.5" />
              {t('newBroadcast')}
            </Link>
          )}
        </div>
      </div>

      {(list.isError || compose.isError) && <Alert tone="danger">{t('loadError')}</Alert>}

      {noChannels ? (
        <div className="rounded-2xl border border-border bg-background p-10 text-center shadow-sm">
          <WechatBadge className="mx-auto mb-3 size-12 text-base" />
          <p className="text-sm">{t('connectFirst')}</p>
          {canChannels && (
            <Link
              href="/wechat"
              className="mt-3 inline-flex h-9 items-center rounded-full px-4 text-xs font-semibold text-white"
              style={{ background: WECHAT_GREEN }}
            >
              {t('connectChannel')}
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-start text-muted-foreground">
                  {(['broadcast', 'audience', 'status'] as const).map((k) => (
                    <th
                      key={k}
                      className="px-5 py-2.5 text-start font-mono text-[10px] uppercase tracking-wide"
                    >
                      {t(`col.${k}`)}
                    </th>
                  ))}
                  <th className="px-5 py-2.5 text-end font-mono text-[10px] uppercase tracking-wide">
                    {t('col.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const audience = audienceLabel(b);
                  const action = rowAction(b);
                  return (
                    <tr
                      key={b.id}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-5 py-3">
                        <div className="font-semibold">{b.name}</div>
                        <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                          {new Date(b.createdAt).toLocaleString()}
                          {b.lastError && <span className="text-danger"> · {b.lastError}</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-[11.5px] text-muted-foreground">
                        {t(`audience.${audience.key}`, audience.values)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 font-mono text-[10.5px] ${PILL[b.status]}`}
                        >
                          {t(`status.${b.status}`)}
                        </span>
                        {b.heldUntil && (
                          <div
                            className="mt-1 font-mono text-[10.5px] text-warning"
                            data-testid="broadcast-held"
                          >
                            {tHold('heldUntil', { when: new Date(b.heldUntil).toLocaleString() })}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {canManage && (
                          <div className="flex items-center justify-end gap-1.5">
                            {action && (
                              <button
                                type="button"
                                className="rounded-full px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                                style={{ background: WECHAT_GREEN }}
                                disabled={busy === b.id}
                                onClick={() => setPendingSend(b)}
                              >
                                {t('send')}
                              </button>
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
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-5 py-12 text-center text-sm text-muted-foreground"
                    >
                      {list.isLoading ? (
                        <Spinner />
                      ) : (
                        <>
                          {t('empty')}{' '}
                          {canManage && (
                            <Link
                              href="/wechat/broadcasts/create"
                              className="font-semibold hover:underline"
                              style={{ color: WECHAT_GREEN }}
                            >
                              {t('createFirst')}
                            </Link>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingSend !== null}
        busy={busy !== null}
        title={t('sendTitle')}
        message={t('sendConfirm')}
        confirmLabel={t('send')}
        cancelLabel={t('cancel')}
        onClose={() => setPendingSend(null)}
        onConfirm={() => {
          const b = pendingSend;
          setPendingSend(null);
          if (b) {
            void act(
              b.id,
              () => (rowAction(b) === 'retry' ? retryBroadcast(b.id) : startBroadcast(b.id)),
              t('started'),
            );
          }
        }}
      />
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
