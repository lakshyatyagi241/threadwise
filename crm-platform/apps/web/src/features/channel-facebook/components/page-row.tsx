'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ConfirmDialog, cn, useToast } from '@crm/ui';
import type { FacebookPage } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { KEYS, refreshPage, removePage, resubscribePage, startLogin } from '../api/facebook';
import { formatCount, initial, relativeTime } from '../lib/format';
import { FB_BLUE, FacebookGlyph, RefreshIcon, TrashIcon } from './fb-icons';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const iconBtn =
  'grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted disabled:opacity-50';

/**
 * One connected Page (WD-FB-001, 004): its picture, name, @username or category, followers, whether it is live, and the Reconnect,
 * Refresh profile, Fix inbound and Remove actions. A Page whose token Meta revoked reads "Reconnect" and offers the login again.
 */
export function PageRow({ page, canManage }: { page: FacebookPage; canManage: boolean }) {
  const t = useTranslations('facebook.page');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [broken, setBroken] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = page.status === 'connected';
  const sub = page.username
    ? `@${page.username.replace(/^@/, '')}`
    : page.category || t('facebookPage');
  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.all });

  const run = async (action: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await action();
      toast(ok, 'success');
      await refresh();
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const reconnect = async () => {
    setBusy(true);
    try {
      window.location.assign((await startLogin()).url);
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
      setBusy(false);
    }
  };

  const fixInbound = async () => {
    setBusy(true);
    try {
      const res = await resubscribePage(page.id);
      toast(res.error ?? t('inboundFixed'), res.error ? 'danger' : 'success');
      await refresh();
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="flex flex-wrap items-center gap-3.5 p-4">
        {page.pictureUrl && !broken ? (
          // Page picture addresses are signed and can expire: on error the Facebook chip takes its place.
          <img
            src={page.pictureUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="size-11 shrink-0 rounded-lg border border-border bg-muted object-cover"
          />
        ) : (
          <span
            className="grid size-11 shrink-0 place-items-center rounded-lg text-white"
            style={{ background: FB_BLUE }}
            aria-hidden
          >
            {page.name ? (
              <span className="text-base font-semibold">{initial(page.name)}</span>
            ) : (
              <FacebookGlyph className="size-5" />
            )}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold">{page.name || page.pageId}</span>
            {live ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-mono text-[10.5px] text-success">
                <span className="size-1.5 rounded-full bg-success" />
                {t('live')}
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 font-mono text-[10.5px] text-warning">
                <span className="size-1.5 rounded-full bg-warning" />
                {t('reconnect')}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11.5px] text-muted-foreground">
            <span>{sub}</span>
            <span>
              {page.fanCount
                ? t('followers', { count: formatCount(page.fanCount) })
                : t('liveNoCount')}
            </span>
          </div>
          {page.lastError && <div className="mt-1 text-[11px] text-danger">{page.lastError}</div>}
          {page.dataAccessExpiresAt && (
            <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
              {t('dataAccess', { when: relativeTime(page.dataAccessExpiresAt, new Date()) })}
            </div>
          )}
        </div>

        {canManage && (
          <div className="flex shrink-0 items-center gap-0.5">
            {!live && (
              <button
                type="button"
                className={iconBtn}
                title={t('reconnect')}
                aria-label={t('reconnect')}
                disabled={busy}
                onClick={() => void reconnect()}
              >
                <RefreshIcon className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              className={iconBtn}
              title={t('refresh')}
              aria-label={t('refresh')}
              disabled={busy}
              onClick={() => void run(() => refreshPage(page.id), t('refreshed'))}
            >
              <RefreshIcon className="size-3.5" />
            </button>
            <button
              type="button"
              className={cn(iconBtn, 'px-2 text-[11px]')}
              disabled={busy}
              onClick={() => void fixInbound()}
            >
              {t('fixInbound')}
            </button>
            <button
              type="button"
              className={cn(iconBtn, 'text-danger hover:bg-danger/10')}
              title={t('remove')}
              aria-label={t('remove')}
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              <TrashIcon className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        busy={busy}
        title={t('remove')}
        message={t('removeConfirm')}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void run(() => removePage(page.id), t('removed'));
        }}
      />
    </div>
  );
}
