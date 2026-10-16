'use client';

import { FormattedText } from './formatted-text';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { memo, useState } from 'react';
import { cn } from '@crm/ui';
import type { ConversationNote, MessageResponse } from '@crm/contracts';
import {
  ContactCards,
  FailureNote,
  InteractiveChip,
  MediaStateNote,
  mediaView,
} from '@/features/channel-whatsapp-cloud';
import { EmailMessageBody } from '@/features/channel-email/components/email-message';
import { composerErrorKey } from '@/features/channel-email/lib/composer-errors';
import { isRetryableSend } from '../lib/errors';
import { groupTallyOf } from '../lib/group-thread';
import { displayMentions } from '../lib/mentions';
import type { AgentReaction, PendingSend } from '../lib/thread';
import { clockTime, fullStamp, humanSize } from '../lib/time';
import {
  AlertIcon,
  FileIcon,
  LinkIcon,
  ListIcon,
  MenuIcon,
  NoteIcon,
  ReplyIcon,
  SmileIcon,
  TrashIcon,
} from './icons';
import {
  AudioMedia,
  DocumentMedia,
  ImageMedia,
  LocationCard,
  StickerMedia,
  VideoMedia,
} from './media';
import { Ticks, useErrorText } from './parts';
import { QuotePreview } from './quote-preview';
import { ReactionBar } from './reaction-bar';
import { StageChangeLine } from './stage-change-line';
import { TemplateMessage } from './template-message';

const BUBBLE = 'relative max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%]';

/** What the body of a message shows: its media, a location, a template, or text, whichever it has. */
function MessageBody({
  message: m,
  onRetry,
}: {
  message: MessageResponse;
  onRetry: (messageId: string) => Promise<void>;
}) {
  const t = useTranslations('team-inbox-conversations.bubble');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const [showOriginal, setShowOriginal] = useState(false);

  const translated = m.isTranslated && m.translatedBody;
  // A personal-number group message names the members it @mentions by their number in the body: show their names.
  const text = translated ? m.translatedBody : displayMentions(m.body, m.mentions);
  const caption = text?.trim() ? text : null;
  const alt = m.media?.name ?? caption ?? t('kind.image');

  const media = m.media;
  const view = mediaView({ kind: m.kind, media, mediaState: m.mediaState });
  let visual: React.ReactNode = null;
  if (m.location) visual = <LocationCard location={m.location} />;
  else if (view === 'pending' || view === 'failed') {
    // The provider's file is still being fetched, or could not be: say so where the file would be. Retry is the same route as a
    // failed send's (the API tells an inbound file from an outbound message).
    visual = (
      <MediaStateNote
        state={view}
        failureCode={m.mediaFailure?.code ?? null}
        onRetry={() => onRetry(m.id)}
      />
    );
  } else if (media) {
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

  // An email carries its own header, HTML body and files (TW-MAIL-026); the frame and the lists are the email feature's.
  if (m.email) {
    return (
      <EmailMessageBody
        email={m.email}
        conversationId={m.conversationId}
        messageId={m.id}
        body={m.body}
        date={m.providerAt ?? m.createdAt}
      />
    );
  }

  const referral =
    m.referral && (m.referral.headline || m.referral.body || m.referral.sourceUrl)
      ? m.referral
      : null;
  const referralCard = referral ? (
    <div
      data-testid="inbox-referral"
      className="mb-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('referral')}
      </p>
      {referral.headline && (
        <p dir="auto" className="font-medium break-words">
          {referral.headline}
        </p>
      )}
      {referral.body && (
        <p dir="auto" className="text-muted-foreground break-words">
          {referral.body}
        </p>
      )}
      {referral.sourceUrl && /^https?:\/\//i.test(referral.sourceUrl) && (
        <a
          href={referral.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline break-all"
        >
          {referral.sourceUrl}
        </a>
      )}
    </div>
  ) : null;

  if (m.kind === 'reaction') {
    return <span className="text-2xl leading-none">{m.reaction ?? m.body}</span>;
  }

  // Buttons an agent or a flow sent: the text, then the buttons as WhatsApp draws them under it.
  if (m.kind === 'interactive' && m.sentInteractive) {
    const s = m.sentInteractive;
    return (
      <div data-testid="inbox-sent-interactive" className="space-y-1.5">
        {s.header && (
          <p dir="auto" className="font-semibold break-words">
            {s.header}
          </p>
        )}
        <p dir="auto" className="whitespace-pre-wrap break-words">
          {s.body}
        </p>
        {s.footer && (
          <p dir="auto" className="text-xs text-muted-foreground break-words">
            {s.footer}
          </p>
        )}
        {s.sections && s.sections.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-background/50 px-2 py-1.5 text-xs">
            {s.sections.map((sec, i) => (
              <li key={i}>
                {sec.title && <p className="font-semibold">{sec.title}</p>}
                <ul>
                  {sec.rows.map((r, j) => (
                    <li key={j} dir="auto" className="break-words">
                      {r.title}
                      {r.description && (
                        <span className="text-muted-foreground"> · {r.description}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <div className="-mx-1 flex flex-col gap-1 pt-1">
          {s.buttons.map((b, i) => (
            <span
              key={i}
              data-testid="inbox-sent-button"
              className="flex items-center justify-center gap-1.5 rounded-lg bg-background/70 px-3 py-1.5 text-center text-sm font-medium text-primary"
            >
              {s.type === 'cta_url' && <LinkIcon width={14} height={14} aria-hidden />}
              {s.type === 'list' && <MenuIcon width={14} height={14} aria-hidden />}
              <span className="break-words">{b.title}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (m.kind === 'interactive' && (m.interactive || caption)) {
    // A Flow answer has no chip, only its text lines: show those as they are, with their line breaks.
    if (!m.interactive && caption && caption.includes('\n')) {
      return (
        <div className="space-y-1">
          {referralCard}
          <p dir="auto" className="whitespace-pre-wrap break-words">
            <FormattedText text={caption} />
          </p>
        </div>
      );
    }
    return (
      <div>
        {referralCard}
        <InteractiveChip kind={m.kind} body={m.body} interactive={m.interactive} />
      </div>
    );
  }

  if (m.kind === 'contact' && (m.contacts?.length || caption)) {
    return <ContactCards kind={m.kind} body={m.body} contacts={m.contacts} />;
  }

  if (m.kind === 'template' && m.template) {
    return <TemplateMessage template={m.template} text={caption} />;
  }

  if (m.unsupported) {
    return (
      <div data-testid="inbox-unsupported" className="space-y-1">
        {referralCard}
        <p dir="auto" className="flex items-start gap-1.5 text-sm italic text-muted-foreground">
          <AlertIcon width={14} height={14} className="mt-0.5 shrink-0" />
          <span className="break-words">{caption ?? t('unsupported')}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {referralCard}
      {visual}
      {caption ? (
        <p dir="auto" className="whitespace-pre-wrap break-words">
          <FormattedText text={caption} />
        </p>
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
          {showOriginal && (
            <p dir="auto" className="mt-0.5 whitespace-pre-wrap break-words italic">
              {m.body}
            </p>
          )}
        </div>
      )}
      {m.kind === 'document' && media?.sizeBytes != null && !visual && (
        <p className="text-xs text-muted-foreground">{humanSize(media.sizeBytes)}</p>
      )}
      <span className="sr-only">{fullStamp(m.createdAt, locale, timeZone)}</span>
    </div>
  );
}

export interface MessageBubbleProps {
  message: MessageResponse;
  quoted: MessageResponse | null;
  /** Starts a reply to this message (the composer shows what it answers). Absent when the person may not reply. */
  onReply?: (message: MessageResponse) => void;
  /** Puts an emoji on this message (`''` takes it back). Absent when the person or the channel cannot react. */
  onReact?: (message: MessageResponse, emoji: string) => Promise<void>;
  /** What the team already put on this message. */
  agentReaction?: AgentReaction | null;
  onRetry: (messageId: string) => Promise<void>;
  /** The person may open the channel settings, so a failure that the channel causes links there. */
  canManageChannel?: boolean;
  /** Opens the message's delivery log (every step it went through). Offered on a message we sent. */
  onOpenLog?: (messageId: string) => void;
  /** On a stage change line: a later "undone" line of the same change is in the thread, so the Undo is gone. */
  stageUndone?: boolean;
}

/**
 * One stored message. Inbound sits at the start, outbound at the end in the brand tint, a system line is centred. An outbound
 * message shows who sent it (a person, a bot, a broadcast), its ticks, and, when the provider refused it, why, with Retry.
 */
export const MessageBubble = memo(function MessageBubble({
  message: m,
  quoted,
  onReply,
  onReact,
  agentReaction = null,
  onRetry,
  canManageChannel = false,
  onOpenLog,
  stageUndone = false,
}: MessageBubbleProps) {
  const t = useTranslations('team-inbox-conversations.bubble');
  const tConsent = useTranslations('contact-consent.systemLine');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const [retrying, setRetrying] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);

  if (m.kind === 'system') {
    // The stage change line is the AI's move, with an Undo; the consent line is worded in the reader's language; every other system
    // line is the server's text.
    if (m.systemEvent?.event === 'stage_change') {
      return (
        <li data-testid="inbox-message" className="flex justify-center">
          <StageChangeLine event={m.systemEvent} undone={stageUndone} />
        </li>
      );
    }
    const consent = m.systemEvent?.event === 'consent' ? m.systemEvent : null;
    return (
      <li data-testid="inbox-message" className="flex justify-center">
        <p
          data-testid={consent ? 'inbox-consent-line' : undefined}
          className="max-w-[80%] rounded-md bg-muted px-3 py-1 text-center text-xs text-muted-foreground"
        >
          {consent
            ? tConsent(consent.action === 'withdrawn' ? 'withdrawn' : 'granted', {
                keyword: (consent.keyword ?? '').toUpperCase(),
              })
            : m.body}
        </p>
      </li>
    );
  }

  const out = m.direction === 'out';
  // "Delivered to 5 of 8, read by 2": what Meta reported per member of a group, rolled up (null for anything else).
  const tally = out ? groupTallyOf(m.groupDelivery) : null;
  const failed = m.status === 'failed';
  // The customer's app only has a message that reached the provider: ours must have been accepted first.
  const canReact =
    onReact !== undefined &&
    m.kind !== 'reaction' &&
    (!out || m.status === 'sent' || m.status === 'delivered' || m.status === 'read');
  const reactionFailed = agentReaction?.status === 'failed';
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
      className={cn(
        'flex',
        out ? 'justify-end' : 'justify-start',
        (m.reaction || agentReaction) && 'pb-2',
      )}
    >
      <div className={cn('flex w-full min-w-0 flex-col', out ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'group/row relative flex w-full min-w-0 items-center gap-1',
            out ? 'flex-row-reverse' : 'flex-row',
          )}
        >
          <div
            className={cn(
              BUBBLE,
              m.email && 'w-full sm:max-w-[90%]',
              out
                ? 'rounded-ee-md border border-primary/25 bg-primary/15 text-foreground'
                : 'rounded-es-md border border-border bg-background',
              failed && 'border-danger/50',
            )}
          >
            {out && sender && (
              <p className="mb-0.5 text-[11px] font-medium text-muted-foreground">{sender}</p>
            )}
            {!out && m.group && (
              <p
                dir="auto"
                data-testid="inbox-group-author"
                className="mb-0.5 text-[11px] font-medium text-primary"
              >
                {m.group.senderName ?? m.group.participant ?? t('groupMember')}
                {m.group.senderName && m.group.participant && (
                  <span className="ms-1 font-normal text-muted-foreground" dir="ltr">
                    {m.group.participant}
                  </span>
                )}
              </p>
            )}
            {m.imported && (
              <p
                data-testid="inbox-imported"
                title={t('importedHint')}
                className="mb-0.5 text-[11px] text-muted-foreground"
              >
                <span className="rounded-full bg-muted px-1.5 py-0.5 font-medium">
                  {t('imported')}
                </span>
              </p>
            )}
            {m.forwarded && (
              <p
                data-testid="inbox-forwarded"
                className="mb-0.5 text-[11px] italic text-muted-foreground"
              >
                {t('forwarded')}
              </p>
            )}
            {m.replyToMessageId && <QuotePreview message={quoted} variant="bubble" />}
            <MessageBody message={m} onRetry={onRetry} />
            {m.reaction && m.kind !== 'reaction' && (
              <span
                data-testid="inbox-customer-reaction"
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
            {agentReaction && (
              <button
                type="button"
                data-testid="inbox-agent-reaction"
                data-status={agentReaction.status}
                disabled={!onReact || reactionFailed}
                onClick={() => void onReact?.(m, '')}
                title={reactionFailed ? t('react.failed') : t('react.takeBack')}
                aria-label={
                  reactionFailed
                    ? t('react.failed')
                    : t('react.takeBackLabel', { emoji: agentReaction.emoji })
                }
                className={cn(
                  'absolute -bottom-3 rounded-full border bg-background px-1.5 py-0.5 text-sm leading-none shadow-sm focus-visible:ring-2 focus-visible:ring-primary',
                  out ? 'end-2' : 'start-2',
                  reactionFailed ? 'border-danger/60 opacity-70' : 'border-primary/40',
                )}
              >
                {agentReaction.emoji}
              </button>
            )}
          </div>
          {canReact && (
            <button
              type="button"
              data-testid="inbox-react"
              aria-label={t('react.label')}
              title={t('react.label')}
              aria-haspopup="true"
              aria-expanded={reactOpen}
              onClick={() => setReactOpen((v) => !v)}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary group-hover/row:opacity-100"
            >
              <SmileIcon width={14} height={14} />
            </button>
          )}
          {reactOpen && canReact && (
            <ReactionBar
              current={agentReaction && !reactionFailed ? agentReaction.emoji : null}
              onPick={(emoji) => {
                setReactOpen(false);
                void onReact?.(m, emoji);
              }}
              onClose={() => setReactOpen(false)}
              className={cn('-top-10', out ? 'end-0' : 'start-0')}
            />
          )}
          {out && onOpenLog && (
            <button
              type="button"
              data-testid="inbox-message-log"
              aria-label={t('deliveryLog')}
              title={t('deliveryLog')}
              onClick={() => onOpenLog(m.id)}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary group-hover/row:opacity-100"
            >
              <ListIcon width={14} height={14} />
            </button>
          )}
          {onReply && (
            <button
              type="button"
              data-testid="inbox-reply"
              aria-label={t('reply')}
              title={t('reply')}
              onClick={() => onReply(m)}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary group-hover/row:opacity-100"
            >
              <ReplyIcon width={14} height={14} />
            </button>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          {m.editedAt && <span className="italic">{t('edited')}</span>}
          <time dateTime={m.createdAt} title={fullStamp(m.createdAt, locale, timeZone)}>
            {clockTime(m.createdAt, locale, timeZone)}
          </time>
          {out && <Ticks status={m.status} />}
          {out && m.hold && (
            <span data-testid="inbox-message-held" className="text-warning" title={t('heldWhy')}>
              {t('heldUntil', { when: fullStamp(m.hold.until, locale, timeZone) })}
            </span>
          )}
          {tally && (
            <span data-testid="inbox-group-tally" className="flex items-center gap-1">
              <span>
                {t(tally.withTotal ? 'groupTally' : 'groupTallyNoTotal', {
                  delivered: tally.delivered,
                  members: tally.members,
                  read: tally.read,
                  failed: tally.failed,
                })}
              </span>
              {tally.billable + tally.free > 0 && (
                <span data-testid="inbox-group-billing" className="opacity-80">
                  {'· '}
                  {t('groupTallyBilled', {
                    billable: tally.billable,
                    free: tally.free,
                  })}
                </span>
              )}
            </span>
          )}
        </div>
        {failed && (
          <div className="mt-0.5 flex flex-wrap items-center justify-end gap-2 px-1 text-xs text-danger">
            <AlertIcon width={12} height={12} />
            <FailureNote failure={m.failure} fallback={t('failed')} canManage={canManageChannel} />
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
            {onOpenLog && (
              <button
                type="button"
                data-testid="inbox-failure-log"
                onClick={() => onOpenLog(m.id)}
                className="rounded font-medium underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-danger"
              >
                {t('deliveryLog')}
              </button>
            )}
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
  const mailError = useTranslations('email.composer.error');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const failed = p.status === 'failed';
  const mailKey = p.error ? composerErrorKey(p.error) : null;
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
          {p.body && (
            <p dir="auto" className="whitespace-pre-wrap break-words">
              <FormattedText text={displayMentions(p.body, p.mentions) ?? ''} />
            </p>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          <time dateTime={p.createdAt}>{clockTime(p.createdAt, locale, timeZone)}</time>
          {failed ? (
            <AlertIcon width={12} height={12} className="text-danger" />
          ) : (
            <Ticks status="queued" />
          )}
          {!failed && <span>{t('sending')}</span>}
        </div>
        {failed && (
          <div className="mt-0.5 flex flex-wrap items-center justify-end gap-2 px-1 text-xs text-danger">
            <span role="alert">
              {mailKey
                ? mailError(mailKey, { seconds: p.retryAfterS ?? 0 })
                : errorText(p.error ?? 'NETWORK')}
            </span>
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
  const timeZone = useTimeZone();
  return (
    <li data-testid="inbox-note" className="flex justify-center">
      <div className="w-full max-w-[85%] rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
          <NoteIcon width={12} height={12} />
          <span>{t('noteLabel')}</span>
          <span className="font-normal normal-case text-muted-foreground">
            · {note.author.name ?? t('unknownAuthor')} ·{' '}
            {clockTime(note.createdAt, locale, timeZone)}
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
        <p dir="auto" className="whitespace-pre-wrap break-words">
          <FormattedText text={note.body} />
        </p>
      </div>
    </li>
  );
}
