'use client';

import { useLocale, useTranslations } from 'next-intl';
import { memo, useState } from 'react';
import { cn } from '@crm/ui';
import type { ConversationNote, MessageResponse } from '@crm/contracts';
import { isRetryableSend } from '../lib/errors';
import type { PendingSend } from '../lib/thread';
import { clockTime, fullStamp, humanSize } from '../lib/time';
import { AlertIcon, FileIcon, NoteIcon, TrashIcon } from './icons';
import {
  AudioMedia,
  DocumentMedia,
  ImageMedia,
  LocationCard,
  StickerMedia,
  VideoMedia,
} from './media';
import { Ticks, useErrorText } from './parts';

const BUBBLE = 'relative max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%]';

/** What the body of a message shows: its media, a location, a template, or text, whichever it has. */
function MessageBody({ message: m }: { message: MessageResponse }) {
  const t = useTranslations('team-inbox-conversations.bubble');
  const locale = useLocale();
  const [showOriginal, setShowOriginal] = useState(false);

  const translated = m.isTranslated && m.translatedBody;
  const text = translated ? m.translatedBody : m.body;
  const caption = text?.trim() ? text : null;
  const alt = m.media?.name ?? caption ?? t('kind.image');

  const media = m.media;
  let visual: React.ReactNode = null;
  if (m.location) visual = <LocationCard location={m.location} />;
  else if (media) {
    switch (m.kind) {
      case 'image':
        visual = <ImageMedia media={media} alt={alt} />;
        break;
      case 'sticker':
        visual = <StickerMedia media={media} alt={alt} />;
        break;
      case 'video':
        visual = <VideoMedia media={media} />;
        break;
      case 'audio':
      case 'voice':
        visual = <AudioMedia media={media} voice={m.kind === 'voice'} />;
        break;
      default:
        visual = <DocumentMedia media={media} />;
    }
  }

  if (m.kind === 'reaction') {
    return <span className="text-2xl leading-none">{m.reaction ?? m.body}</span>;
  }

  if (m.kind === 'template' && m.template) {
    const vars = Object.entries(m.template.variables);
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          {t('template', { name: m.template.name })}
        </p>
        {caption && <p dir="auto" className="whitespace-pre-wrap break-words">{caption}</p>}
        {!caption && vars.length > 0 && (
          <p className="text-xs text-muted-foreground">{vars.map(([, v]) => v).join(' · ')}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {visual}
      {caption ? (
        <p dir="auto" className="whitespace-pre-wrap break-words">{caption}</p>
      ) : !visual ? (
        <p className="text-xs italic text-muted-foreground">{t('unavailable')}</p>
      ) : null}
      {translated && m.body && (
        <div className="text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            aria-expanded={showOriginal}
            className="underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            {m.direction === 'out'
              ? t('sentIn', { lang: (m.detectedLanguage ?? '').toUpperCase() })
              : t('translatedFrom', { lang: (m.detectedLanguage ?? '').toUpperCase() })}
          </button>
          {showOriginal && <p dir="auto" className="mt-0.5 whitespace-pre-wrap break-words italic">{m.body}</p>}
        </div>
      )}
      {m.kind === 'document' && media?.sizeBytes != null && !visual && (
        <p className="text-xs text-muted-foreground">{humanSize(media.sizeBytes)}</p>
      )}
      <span className="sr-only">{fullStamp(m.createdAt, locale)}</span>
    </div>
  );
}

export interface MessageBubbleProps {
  message: MessageResponse;
  quoted: MessageResponse | null;
  onRetry: (messageId: string) => Promise<void>;
}

/**
 * One stored message. Inbound sits at the start, outbound at the end in the brand tint, a system line is centred. An outbound
 * message shows who sent it (a person, a bot, a broadcast), its ticks, and, when the provider refused it, why, with Retry.
 */
export const MessageBubble = memo(function MessageBubble({ message: m, quoted, onRetry }: MessageBubbleProps) {
  const t = useTranslations('team-inbox-conversations.bubble');
  const locale = useLocale();
  const [retrying, setRetrying] = useState(false);

  if (m.kind === 'system') {
    return (
      <li data-testid="inbox-message" className="flex justify-center">
        <p className="max-w-[80%] rounded-md bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
          {m.body}
        </p>
      </li>
    );
  }

  const out = m.direction === 'out';
  const failed = m.status === 'failed';
  const sender =
    m.sender.kind === 'agent'
      ? m.sender.name
      : m.sender.kind === 'bot'
        ? (m.sender.name ?? t('bot'))
        : m.sender.kind === 'broadcast'
          ? t('broadcast')
          : null;

  return (
    <li
      data-testid="inbox-message"
      data-message-id={m.id}
      data-direction={m.direction}
      data-status={m.status}
      id={`msg-${m.id}`}
      className={cn('flex', out ? 'justify-end' : 'justify-start')}
    >
      <div className={cn('flex w-full min-w-0 flex-col', out ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            BUBBLE,
            out
              ? 'rounded-ee-md border border-primary/25 bg-primary/15 text-foreground'
              : 'rounded-es-md border border-border bg-background',
            failed && 'border-danger/50',
          )}
        >
          {out && sender && (
            <p className="mb-0.5 text-[11px] font-medium text-muted-foreground">{sender}</p>
          )}
          {quoted && (
            <p dir="auto" className="mb-1 truncate border-s-2 border-primary/50 ps-2 text-xs text-muted-foreground">
              {quoted.body ?? t(`kind.${quoted.kind === 'text' ? 'text' : 'attachment'}`)}
            </p>
          )}
          <MessageBody message={m} />
          {m.reaction && m.kind !== 'reaction' && (
            <span
              className={cn(
                'absolute -bottom-3 rounded-full border border-border bg-background px-1.5 py-0.5 text-sm leading-none shadow-sm',
                out ? 'start-2' : 'end-2',
              )}
              role="img"
              aria-label={t('reacted', { emoji: m.reaction })}
            >
              {m.reaction}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          {m.editedAt && <span className="italic">{t('edited')}</span>}
          <time dateTime={m.createdAt} title={fullStamp(m.createdAt, locale)}>
            {clockTime(m.createdAt, locale)}
          </time>
          {out && <Ticks status={m.status} />}
        </div>
        {failed && (
          <div className="mt-0.5 flex flex-wrap items-center justify-end gap-2 px-1 text-xs text-danger">
            <AlertIcon width={12} height={12} />
            <span data-testid="inbox-failure">{m.failure?.reason ?? t('failed')}</span>
            <button
              type="button"
              data-testid="inbox-retry"
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                void onRetry(m.id).finally(() => setRetrying(false));
              }}
              className="rounded font-medium underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
            >
              {t('retry')}
            </button>
          </div>
        )}
      </div>
    </li>
  );
});

export interface PendingBubbleProps {
  pending: PendingSend;
  progress: number | undefined;
  onRetry: (clientMessageId: string) => void;
  onDismiss: (clientMessageId: string) => void;
}

/** A send that has no stored message yet: shown at once with a clock, or with the reason it did not go. */
export function PendingBubble({ pending: p, progress, onRetry, onDismiss }: PendingBubbleProps) {
  const t = useTranslations('team-inbox-conversations.bubble');
  const errorText = useErrorText();
  const locale = useLocale();
  const failed = p.status === 'failed';
  return (
    <li
      data-testid="inbox-pending"
      data-client-message-id={p.clientMessageId}
      data-status={p.status}
      className="flex justify-end"
    >
      <div className="flex w-full min-w-0 flex-col items-end">
        <div
          className={cn(
            BUBBLE,
            'rounded-ee-md border bg-primary/10 text-foreground',
            failed ? 'border-danger/50' : 'border-primary/20 opacity-80',
          )}
        >
          {p.media && (
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <FileIcon width={14} height={14} />
              <span className="truncate">{p.media.name}</span>
              {p.media.sizeBytes != null && <span>{humanSize(p.media.sizeBytes)}</span>}
              {!failed && progress !== undefined && progress < 100 && <span>{progress}%</span>}
            </div>
          )}
          {p.body && <p dir="auto" className="whitespace-pre-wrap break-words">{p.body}</p>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          <time dateTime={p.createdAt}>{clockTime(p.createdAt, locale)}</time>
          {failed ? <AlertIcon width={12} height={12} className="text-danger" /> : <Ticks status="queued" />}
          {!failed && <span>{t('sending')}</span>}
        </div>
        {failed && (
          <div className="mt-0.5 flex flex-wrap items-center justify-end gap-2 px-1 text-xs text-danger">
            <span role="alert">{errorText(p.error ?? 'NETWORK')}</span>
            {isRetryableSend(p.error ?? 'NETWORK') && (
              <button
                type="button"
                data-testid="inbox-retry-pending"
                onClick={() => onRetry(p.clientMessageId)}
                className="rounded font-medium underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-danger"
              >
                {t('retry')}
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss(p.clientMessageId)}
              className="rounded text-muted-foreground underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('dismiss')}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/** An internal note in the thread: amber, with its author and time, never confused with a message the customer can see. */
export function NoteBubble({
  note,
  canDelete,
  onDelete,
}: {
  note: ConversationNote;
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations('team-inbox-conversations.bubble');
  const locale = useLocale();
  return (
    <li data-testid="inbox-note" className="flex justify-center">
      <div className="w-full max-w-[85%] rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
          <NoteIcon width={12} height={12} />
          <span>{t('noteLabel')}</span>
          <span className="font-normal normal-case text-muted-foreground">
            · {note.author.name ?? t('unknownAuthor')} · {clockTime(note.createdAt, locale)}
          </span>
          {canDelete && (
            <button
              type="button"
              aria-label={t('deleteNote')}
              title={t('deleteNote')}
              onClick={() => onDelete(note.id)}
              className="ms-auto rounded p-0.5 text-muted-foreground hover:text-danger focus-visible:ring-2 focus-visible:ring-primary"
            >
              <TrashIcon width={12} height={12} />
            </button>
          )}
        </div>
        <p dir="auto" className="whitespace-pre-wrap break-words">{note.body}</p>
      </div>
    </li>
  );
}
