'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, ConfirmDialog, Input, useToast } from '@crm/ui';
import type { MailboxResponse, MailConnectionTestResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  KEYS,
  removeMailbox,
  renameMailbox,
  setSendLimit,
  syncMailbox,
  testMailbox,
} from '../api/mailboxes';
import { mailErrorKey } from '../lib/api-errors';
import {
  canRemove,
  canSync,
  inboxHref,
  nameDraft,
  needsReconnect,
  sendLimitDraft,
  statusView,
  type MailboxAccess,
} from '../lib/hub-model';
import { lagIsHigh, lagView, testErrorKey } from '../lib/test-view';
import { ConnectionTestResult } from './connection-test-result';

const dateTime = (iso: string, locale: string, timeZone?: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    new Date(iso),
  );

/**
 * One connected mailbox (TW-MAIL-019, 023, 028, 031, 034, 035): address, provider and scope (shared, or personal with its owner), the
 * name replies go out under (editable), its health, live-update and signature chips, the hourly send limit (editable), when it last
 * synced and how many conversations it holds, and the actions: open it in the inbox, sync now, reconnect, remove. Someone else's
 * personal mailbox is only a summary row (address, provider, owner, status): no content and no actions.
 */
export function MailboxCard({
  mailbox,
  access,
  onReconnect,
  reconnecting,
}: {
  mailbox: MailboxResponse;
  access: MailboxAccess;
  onReconnect: (mailbox: MailboxResponse) => void;
  reconnecting: boolean;
}) {
  const canManage = access.canAct;
  const t = useTranslations('email.card');
  const tt = useTranslations('email.imap.test');
  const root = useTranslations('email');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(mailbox.displayName);
  const [limitEditing, setLimitEditing] = useState(false);
  const [limitDraft, setLimitDraft] = useState('');
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<MailConnectionTestResponse | null>(null);
  const status = statusView(mailbox.status);
  const href = access.canOpen ? inboxHref(mailbox) : null;
  const limit = sendLimitDraft(limitDraft, mailbox.sendLimitPerHour);
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

  /** "Test connection" on an IMAP mailbox: the server tries the stored login on both servers; nothing changes and nothing is sent. */
  const runTest = async () => {
    setTesting(true);
    setTested(null);
    try {
      setTested(await testMailbox(mailbox.id));
    } catch (e) {
      toast(tt(e instanceof ApiError ? testErrorKey(e.code) : 'failed'), 'danger');
    } finally {
      setTesting(false);
    }
  };

  const lag = lagView(mailbox.syncLagSeconds);
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

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge data-testid="email-provider-badge">{t(`provider.${mailbox.provider}`)}</Badge>
          <Badge
            tone={mailbox.scope === 'personal' ? 'warning' : 'neutral'}
            data-testid="email-scope-badge"
            data-scope={mailbox.scope}
          >
            {mailbox.scope === 'personal'
              ? mailbox.ownerName
                ? t('scope.personalOf', { name: mailbox.ownerName })
                : t('scope.personal')
              : t('scope.shared')}
          </Badge>
          {!access.summaryOnly && mailbox.pushActive && (
            <Badge tone="success" data-testid="email-push" title={t('pushHint')}>
              {t('push')}
            </Badge>
          )}
          {!access.summaryOnly && mailbox.hasSignature && (
            <Badge data-testid="email-signature-chip" title={t('signatureHint')}>
              {t('signature')}
            </Badge>
          )}
        </div>

        {access.summaryOnly && (
          <p data-testid="email-summary-note" className="text-xs text-muted-foreground">
            {t('summaryNote')}
          </p>
        )}

        {!access.summaryOnly &&
          (editing ? (
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
          ))}

        {!access.summaryOnly && mailbox.status === 'needs_reauth' && (
          <p role="status" className="text-xs text-warning">
            {t('needsReauthHint')}
          </p>
        )}
        {!access.summaryOnly && mailbox.lastError && mailbox.status !== 'connected' && (
          <p
            data-testid="email-last-error"
            dir="auto"
            className="break-words rounded-md bg-danger/10 px-2 py-1 text-xs text-danger"
          >
            {t('lastError', { error: mailbox.lastError })}
          </p>
        )}

        {!access.summaryOnly && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <div className={row}>
              <span className="text-muted-foreground">{t('lastSynced')}</span>
              <span className="font-mono">
                {mailbox.lastSyncedAt
                  ? dateTime(mailbox.lastSyncedAt, locale, timeZone)
                  : t('neverSynced')}
              </span>
            </div>
            {lag && (
              <div className={row}>
                <span className="text-muted-foreground">{t('lag')}</span>
                <span
                  className={
                    lagIsHigh(mailbox.syncLagSeconds) ? 'font-mono text-warning' : 'font-mono'
                  }
                  data-testid="email-lag"
                >
                  {lag.key === 'lagUnderMinute' ? t(lag.key) : t(lag.key, { count: lag.count })}
                </span>
              </div>
            )}
            <div className={row}>
              <span className="text-muted-foreground">{t('conversations')}</span>
              <span className="font-mono">{mailbox.conversationCount}</span>
            </div>
            {limitEditing ? (
              <form
                className="flex items-center gap-2 pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!limit.ok) return;
                  if (!limit.changed) {
                    setLimitEditing(false);
                    return;
                  }
                  void run(
                    () =>
                      setSendLimit(
                        mailbox.id,
                        mailbox.displayName,
                        limit.value,
                        mailbox.rowVersion,
                      ),
                    t('limitSaved'),
                  ).then((ok) => ok && setLimitEditing(false));
                }}
              >
                <Input
                  aria-label={t('sendLimit')}
                  aria-invalid={!limit.ok || undefined}
                  value={limitDraft}
                  inputMode="numeric"
                  dir="ltr"
                  autoFocus
                  placeholder={t('limitDefault')}
                  onChange={(e) => setLimitDraft(e.target.value)}
                  className="h-8 text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  className="rounded-full"
                  disabled={busy || !limit.ok}
                >
                  {t('save')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() => setLimitEditing(false)}
                >
                  {t('cancel')}
                </Button>
              </form>
            ) : (
              <div className={row}>
                <span className="text-muted-foreground">{t('sendLimit')}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono" data-testid="email-send-limit">
                    {mailbox.sendLimitPerHour === null
                      ? t('limitDefault')
                      : t('limitPerHour', { count: mailbox.sendLimitPerHour })}
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => {
                        setLimitDraft(
                          mailbox.sendLimitPerHour === null ? '' : String(mailbox.sendLimitPerHour),
                        );
                        setLimitEditing(true);
                      }}
                      className="rounded text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {t('edit')}
                    </button>
                  )}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {tested && (
        <div className="border-t border-border px-4 py-3">
          <ConnectionTestResult result={tested} />
        </div>
      )}

      {(href || canManage) && (
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
          {canManage && mailbox.provider === 'imap' && mailbox.status !== 'disconnected' && (
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              disabled={busy || testing}
              onClick={() => void runTest()}
              data-testid="email-test-connection"
            >
              {testing ? t('testing') : t('test')}
            </Button>
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
              onClick={() => onReconnect(mailbox)}
            >
              {t('reconnect')}
            </Button>
          )}
          {canManage && canRemove(mailbox) && (
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
      )}

      {canManage && canRemove(mailbox) && (
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
