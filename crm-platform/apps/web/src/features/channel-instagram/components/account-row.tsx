'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ConfirmDialog, cn, useToast } from '@crm/ui';
import type { IgAccount, IgBridge } from '@crm/contracts';
import { formatRelative } from '@/features/auth-registration-security/shared/relative-time';
import { ApiError } from '@/lib/api/errors';
import { KEYS, linkAccount, unlinkAccount } from '../api/instagram';
import { handleOf, initialsOf, isConnected } from '../lib/accounts-model';
import {
  ExternalIcon,
  InstagramGlyph,
  InstagramGradientGlyph,
  RefreshIcon,
  TrashIcon,
} from './ig-icons';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const iconBtn =
  'grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted disabled:opacity-50';

/**
 * One linked Instagram account (TW-IG-001, 004, 006): picture (or the camera chip, or the initials when the signed picture address
 * has expired), name, @handle, when it was last read from the engine ("live" when never), whether it is connected, and the Manage,
 * Refresh and Unlink actions. Unlinking the last account also deletes the workspace's Instagram conversations, and says so first.
 */
export function AccountRow({
  account,
  bridge,
  canManage,
}: {
  account: IgAccount;
  bridge: IgBridge;
  canManage: boolean;
}) {
  const t = useTranslations('instagram.row');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [broken, setBroken] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = isConnected(account.status);
  const handle = handleOf(account.username, account.name);

  const refresh = async () => {
    setBusy(true);
    try {
      const row = await linkAccount({ instaflowAccountId: account.instaflowAccountId });
      toast(t('updated', { handle: handleOf(row.username, row.name) }), 'success');
      await qc.invalidateQueries({ queryKey: KEYS.all });
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setConfirming(false);
    setBusy(true);
    try {
      await unlinkAccount(account.id);
      toast(t('unlinked'), 'success');
      await qc.invalidateQueries({ queryKey: KEYS.all });
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div className="flex flex-wrap items-center gap-3.5 p-4">
        {account.avatar && !broken ? (
          // Instagram picture addresses are signed and expire: on error the initials chip takes their place.
          <img
            src={account.avatar}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="size-11 shrink-0 rounded-lg border border-border bg-muted object-cover"
          />
        ) : account.avatar ? (
          <span
            className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold"
            aria-hidden
          >
            {initialsOf(account.name, account.username)}
          </span>
        ) : (
          <span
            className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-foreground"
            aria-hidden
          >
            <InstagramGlyph className="size-5" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold">{account.name || handle}</span>
            {live ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-mono text-[10.5px] text-success">
                <span className="size-1.5 rounded-full bg-success" />
                {t('connected')}
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-border" />
                {t('needsReauth')}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <InstagramGradientGlyph className="size-3 shrink-0" />
              {t('channel')}
            </span>
            <span>{handle}</span>
            <span>
              {account.syncedAt
                ? formatRelative(account.syncedAt, new Date().getTime(), locale)
                : t('live')}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {bridge.manageUrl && (
            <a
              href={bridge.manageUrl}
              target="_blank"
              rel="noopener"
              className={iconBtn}
              title={t('manage', { engine: bridge.brand })}
              aria-label={t('manage', { engine: bridge.brand })}
            >
              <ExternalIcon className="size-3.5" />
            </a>
          )}
          {canManage && (
            <>
              <button
                type="button"
                className={iconBtn}
                title={t('refresh', { engine: bridge.brand })}
                aria-label={t('refresh', { engine: bridge.brand })}
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshIcon className="size-3.5" />
              </button>
              <button
                type="button"
                className={cn(iconBtn, 'text-danger hover:bg-danger/10')}
                title={t('unlink')}
                aria-label={t('unlink')}
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                <TrashIcon className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        busy={busy}
        title={t('unlink')}
        message={t('unlinkConfirm', { engine: bridge.brand })}
        confirmLabel={t('unlink')}
        cancelLabel={t('cancel')}
        onClose={() => setConfirming(false)}
        onConfirm={() => void unlink()}
      />
    </div>
  );
}
