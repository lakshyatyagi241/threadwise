'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog, Textarea, Button, cn, useToast } from '@crm/ui';
import type { TchatMe, TchatMessageResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { chatApi } from '../api/service';
import { parseBody } from '../lib/body';
import { attachmentHref, canEditNow, formatStamp, humanSize } from '../lib/format';
import { FileIcon } from './icons';
import { Avatar, useErrorText } from './parts';

/** The six reactions the tray offers; the API accepts any emoji. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '👀'] as const;

export interface MessageItemProps {
  message: TchatMessageResponse;
  me: TchatMe;
  now: Date;
  onReply: (message: TchatMessageResponse) => void;
  onPatched: (message: TchatMessageResponse) => void;
  onRemoved: (id: string) => void;
  onPinChanged: () => void;
}

/** One message: bubble, quote, attachment, reactions and the actions the caller may take on it. */
export function MessageItem({
  message: m,
  me,
  now,
  onReply,
  onPatched,
  onRemoved,
  onPinChanged,
}: MessageItemProps) {
  const t = useTranslations('team-chat.message');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const { toast } = useToast();
  const errorText = useErrorText();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [tray, setTray] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const mine = m.isMine;
  const canEdit = mine && canEditNow(m.createdAt, now.getTime());
  const canPin = mine || me.canModerate;
  const canDelete = mine || me.canModerate;

  async function react(emoji: string) {
    setTray(false);
    try {
      const out = await chatApi.react(m.id, emoji);
      onPatched({ ...m, reactions: out.reactions });
    } catch (e) {
      toast(errorText(e), 'danger');
    }
  }

  async function togglePin() {
    try {
      const out = await chatApi.pin(m.id);
      onPatched({ ...m, pinnedAt: out.pinned ? new Date().toISOString() : null });
      onPinChanged();
    } catch (e) {
      toast(errorText(e), 'danger');
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await chatApi.remove(m.id);
      onRemoved(m.id);
      setConfirm(false);
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    const body = draft.trim();
    if (!body || body === (m.body ?? '')) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      onPatched(await chatApi.edit(m.id, body, m.rowVersion));
      setEditing(false);
    } catch (e) {
      // A conflict means someone (or another tab) changed it: show the reason, keep the draft, let them look.
      toast(
        e instanceof ApiError && e.isRowVersionConflict ? t('editConflict') : errorText(e),
        'danger',
      );
    } finally {
      setBusy(false);
    }
  }

  const action =
    'rounded px-1 text-[10px] text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <li
      id={`msg-${m.id}`}
      data-testid="tchat-message"
      className={cn('flex gap-2.5', mine && 'flex-row-reverse')}
    >
      <Avatar id={m.authorId ?? m.id} name={m.authorName} />
      <div className={cn('flex min-w-0 max-w-[70%] flex-col gap-0.5', mine && 'items-end')}>
        <div className="flex items-baseline gap-2 text-[10px] text-muted-foreground">
          <span className="text-xs font-semibold text-foreground">{m.authorName}</span>
          <time dateTime={m.createdAt} className="font-mono">
            {formatStamp(m.createdAt, now, locale, timeZone)}
          </time>
          {m.editedAt && <span>{t('edited')}</span>}
          {m.pinnedAt && <span aria-label={t('pinned')}>📌</span>}
        </div>

        <div
          className={cn(
            'min-w-0 rounded-md border px-3 py-2 text-[13px] leading-snug',
            mine ? 'border-transparent bg-success/20' : 'border-border bg-background',
          )}
        >
          {m.replyTo && (
            <a
              href={`#msg-${m.replyTo.id}`}
              className="mb-1 block truncate border-s-2 border-primary ps-2 text-[10.5px] text-muted-foreground"
            >
              <span className="font-semibold text-primary">{m.replyTo.authorName}</span> ·{' '}
              {m.replyTo.snippet}
            </a>
          )}

          {editing ? (
            <div className="space-y-2" style={{ minWidth: 'min(20rem, 70vw)' }}>
              <Textarea
                aria-label={t('editLabel')}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(false);
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void saveEdit();
                }}
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditing(false)}
                  disabled={busy}
                >
                  {t('cancel')}
                </Button>
                <Button size="sm" onClick={() => void saveEdit()} disabled={busy}>
                  {t('save')}
                </Button>
              </div>
            </div>
          ) : (
            m.body && <Body body={m.body} meId={me.id} />
          )}

          {m.attachment && (
            <div className={cn(m.body && 'mt-2')}>
              {m.attachment.isImage ? (
                <a href={attachmentHref(m.id, m.attachment.name)} target="_blank" rel="noreferrer">
                  <img
                    src={attachmentHref(m.id, m.attachment.name)}
                    alt={m.attachment.name}
                    loading="lazy"
                    className="max-h-70 max-w-70 rounded-md border border-border object-cover"
                  />
                </a>
              ) : (
                <a
                  href={attachmentHref(m.id, m.attachment.name)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-2 text-xs hover:bg-muted/70"
                >
                  <FileIcon />
                  <span className="truncate font-medium">{m.attachment.name}</span>
                </a>
              )}
            </div>
          )}
        </div>

        {m.reactions.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label={t('reactions')}>
            {m.reactions.map((r) => (
              <li key={r.emoji}>
                <button
                  type="button"
                  aria-pressed={r.mine}
                  aria-label={t('reactionChip', { emoji: r.emoji, count: r.count })}
                  onClick={() => void react(r.emoji)}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                    r.mine ? 'border-primary bg-primary/10' : 'border-border bg-background',
                  )}
                >
                  <span>{r.emoji}</span>
                  <span>{r.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!editing && (
          <div className="relative flex flex-wrap items-center gap-1">
            <button type="button" className={action} onClick={() => onReply(m)}>
              {t('reply')}
            </button>
            <button
              type="button"
              className={action}
              aria-expanded={tray}
              onClick={() => setTray((v) => !v)}
            >
              {t('react')}
            </button>
            {canEdit && (
              <button
                type="button"
                className={action}
                onClick={() => {
                  setDraft(m.body ?? '');
                  setEditing(true);
                }}
              >
                {t('edit')}
              </button>
            )}
            {canPin && (
              <button type="button" className={action} onClick={() => void togglePin()}>
                {m.pinnedAt ? t('unpin') : t('pin')}
              </button>
            )}
            {canDelete && (
              <button type="button" className={action} onClick={() => setConfirm(true)}>
                {t('delete')}
              </button>
            )}
            {tray && (
              <div
                role="group"
                aria-label={t('reactionTray')}
                className="absolute bottom-full start-0 z-10 mb-1 flex gap-1 rounded-full border border-border bg-background p-1 shadow-md"
              >
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={emoji}
                    onClick={() => void react(emoji)}
                    className="size-8 rounded-full text-base hover:bg-muted"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        title={t('deleteTitle')}
        message={t('deleteMessage')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => setConfirm(false)}
      />
    </li>
  );
}

/** The text with newlines kept and mention tokens as pills (amber for the caller). Never markup from the message. */
export function Body({ body, meId }: { body: string; meId: string }) {
  return (
    <p className="whitespace-pre-wrap break-words">
      {parseBody(body).map((part, i) =>
        part.type === 'text' ? (
          <span key={i}>{part.text}</span>
        ) : (
          <span
            key={i}
            className={cn(
              'rounded px-1 font-medium',
              part.userId === meId ? 'bg-warning/20 text-warning' : 'bg-success/15 text-success',
            )}
          >
            @{part.name}
          </span>
        ),
      )}
    </p>
  );
}

/** A send in flight or refused: dimmed, with a progress bar for a file and a retry for a failure. */
export function PendingItem({
  authorName,
  authorId,
  body,
  file,
  status,
  progress,
  error,
  createdAt,
  now,
  meId,
  onRetry,
  onDismiss,
}: {
  authorName: string;
  authorId: string;
  body: string;
  file: { name: string; size: number } | null;
  status: 'sending' | 'failed';
  progress: number;
  error: string | null;
  createdAt: string;
  now: Date;
  meId: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('team-chat.message');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const errorText = useErrorText();
  return (
    <li data-testid="tchat-pending" className="flex flex-row-reverse gap-2.5">
      <Avatar id={authorId} name={authorName} />
      <div className="flex min-w-0 max-w-[70%] flex-col items-end gap-0.5">
        <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{authorName}</span>
          <time dateTime={createdAt}>{formatStamp(createdAt, now, locale, timeZone)}</time>
        </div>
        <div
          className={cn(
            'min-w-0 rounded-md border border-transparent bg-success/20 px-3 py-2 text-[13px] leading-snug',
            status === 'sending' ? 'opacity-70' : 'opacity-60',
          )}
        >
          {body && <Body body={body} meId={meId} />}
          {file && (
            <div className={cn('flex items-center gap-2 text-xs', body && 'mt-2')}>
              <FileIcon />
              <span className="truncate font-medium">{file.name}</span>
              <span className="text-muted-foreground">{humanSize(file.size)}</span>
            </div>
          )}
          {status === 'sending' && file && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label={t('uploading')}
              className="mt-2 h-1 overflow-hidden rounded bg-border"
            >
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        {status === 'failed' && (
          <div role="alert" className="flex items-center gap-2 text-xs text-danger">
            <span>{errorText(error ?? 'network')}</span>
            <button type="button" className="underline" onClick={onRetry}>
              {t('retry')}
            </button>
            <button type="button" className="underline" onClick={onDismiss}>
              {t('discard')}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
