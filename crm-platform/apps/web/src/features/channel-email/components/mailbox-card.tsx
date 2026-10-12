'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, ConfirmDialog, Input, useToast } from '@crm/ui';
import type { MailboxResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { KEYS, removeMailbox, renameMailbox, syncMailbox } from '../api/mailboxes';
import { mailErrorKey } from '../lib/api-errors';
import { canSync, inboxHref, nameDraft, needsReconnect, statusView } from '../lib/hub-model';

const dateTime = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/**
 * One connected mailbox (TW-MAIL-019, 023, 028): address, the name replies go out under (editable), its health, when it last synced,
 * how many conversations it holds, and the actions: open it in the inbox, sync now, reconnect, remove.
 */
export function MailboxCard({
  mailbox,
  canManage,
  onReconnect,
  reconnecting,
}: {
  mailbox: MailboxResponse;
  canManage: boolean;
  onReconnect: (mailboxId: string) => void;
  reconnecting: boolean;
}) {
  const t = useTranslations('email.card');
  const root = useTranslations('email');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(mailbox.displayName);
  const status = statusView(mailbox.status);
  const href = inboxHref(mailbox);
  const name = nameDraft(mailbox.displayName, draft);

  const run = async (action: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await action();
      toast(ok, 'success');
      await qc.invalidateQueries({ queryKey: KEYS.all });
      return true;
    } catch (e) {
      const key = e instanceof ApiError ? mailErrorKey(e.code) : null;
      toast(
        key ? root(`errors.${key}`) : e instanceof ApiError ? e.message : t('failed'),
        'danger',
      );
      // A stale row version means the list is behind: reload it so the next try uses the new one.
      if (e instanceof ApiError && e.isRowVersionConflict)
        await qc.invalidateQueries({ queryKey: KEYS.all });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const row = 'flex items-center justify-between gap-3 text-xs';
  return (
    <div
      data-testid="email-mailbox"
      data-status={mailbox.status}
      className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
    >
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <span
            className="min-w-0 truncate font-mono text-[15px] font-semibold"
            dir="ltr"
            title={mailbox.address}
          >
            {mailbox.address}
          </span>
          <Badge tone={status.tone} data-testid="email-status" className="shrink-0">
            {t(`status.${status.key}`)}
          </Badge>
        </div>

        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.ok) return;
              if (!name.changed) {
                setEditing(false);
                return;
              }
              void run(
                () => renameMailbox(mailbox.id, name.value, mailbox.rowVersion),
                t('renamed'),
              ).then((ok) => ok && setEditing(false));
            }}
          >
            <Input
              aria-label={t('displayName')}
              value={draft}
              maxLength={80}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 text-xs"
            />
            <Button type="submit" size="sm" className="rounded-full" disabled={busy || !name.ok}>
              {t('save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="rounded-full"
              disabled={busy}
              onClick={() => {
                setDraft(mailbox.displayName);
                setEditing(false);
              }}
            >
              {t('cancel')}
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t('sendsAs')}</span>
            <span dir="auto" className="min-w-0 truncate font-medium">
              {mailbox.displayName}
            </span>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setDraft(mailbox.displayName);
                  setEditing(true);
                }}
                className="shrink-0 rounded text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t('edit')}
              </button>
            )}
          </div>
        )}

        {mailbox.status === 'needs_reauth' && (
          <p role="status" className="text-xs text-warning">
            {t('needsReauthHint')}
          </p>
        )}
        {mailbox.lastError && mailbox.status !== 'connected' && (
          <p
            data-testid="email-last-error"
            dir="auto"
            className="break-words rounded-md bg-danger/10 px-2 py-1 text-xs text-danger"
          >
            {t('lastError', { error: mailbox.lastError })}
          </p>
        )}

        <div className="space-y-1.5 border-t border-border pt-3">
          <div className={row}>
            <span className="text-muted-foreground">{t('lastSynced')}</span>
            <span className="font-mono">
              {mailbox.lastSyncedAt ? dateTime(mailbox.lastSyncedAt, locale) : t('neverSynced')}
            </span>
          </div>
          <div className={row}>
            <span className="text-muted-foreground">{t('conversations')}</span>
            <span className="font-mono">{mailbox.conversationCount}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
        {href && (
          <Link
            href={href}
            data-testid="email-open-inbox"
            className="inline-flex h-8 items-center rounded-full border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
          >
            {t('openInbox')}
          </Link>
        )}
        {canManage && canSync(mailbox) && (
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            disabled={busy}
            onClick={() => void run(() => syncMailbox(mailbox.id), t('syncStarted'))}
          >
            {t('sync')}
          </Button>
        )}
        {canManage && needsReconnect(mailbox) && (
          <Button
            size="sm"
            className="rounded-full"
            disabled={busy || reconnecting}
            onClick={() => onReconnect(mailbox.id)}
          >
            {t('reconnect')}
          </Button>
        )}
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full text-danger"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {t('remove')}
          </Button>
        )}
      </div>

      {canManage && (
        <ConfirmDialog
          open={confirming}
          tone="danger"
          busy={busy}
          title={t('removeTitle')}
          message={t('removeConfirm', { address: mailbox.address })}
          confirmLabel={t('remove')}
          cancelLabel={t('cancel')}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void run(() => removeMailbox(mailbox.id), t('removed'));
          }}
        />
      )}
    </div>
  );
}
