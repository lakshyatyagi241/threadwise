'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { MessageKind, MessageResponse } from '@crm/contracts';

/** The label a quoted message shows when it has no text of its own (a photo, a voice note, a location...). */
const KIND_LABEL: Record<MessageKind, string> = {
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  voice: 'voice',
  document: 'document',
  sticker: 'sticker',
  location: 'location',
  contact: 'contact',
  template: 'template',
  reaction: 'reaction',
  interactive: 'interactive',
  system: 'text',
};

/** Scrolls to a message in the thread and flashes it, so the reader sees which one was meant. */
export function jumpToMessage(id: string) {
  const el = document.getElementById(`msg-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('inbox-flash');
  window.setTimeout(() => el.classList.remove('inbox-flash'), 1600);
}

export interface QuotePreviewProps {
  /** The message answered; null when it is older than what is loaded (the bubble still says it is a reply). */
  message: MessageResponse | null;
  /** `bubble`: inside a bubble, tapping jumps to the original. `composer`: above the box, what the next send answers. */
  variant: 'bubble' | 'composer';
  className?: string;
}

/** Who said it, and what: its text, or the kind of thing it was. */
export function QuotePreview({ message: q, variant, className }: QuotePreviewProps) {
  const t = useTranslations('team-inbox-conversations.bubble.quote');
  const who = !q
    ? null
    : q.direction === 'out'
      ? q.sender.kind === 'agent' && q.sender.name
        ? q.sender.name
        : t('you')
      : t('customer');
  const text = q?.body?.trim() || q?.media?.name || null;
  const label = q ? t(`kind.${KIND_LABEL[q.kind]}`) : t('missing');
  const body = (
    <>
      {who && (
        <span className="block truncate text-[11px] font-semibold text-primary" dir="auto">
          {variant === 'composer' ? t('replyingTo', { name: who }) : who}
        </span>
      )}
      <span dir="auto" className="block truncate text-xs text-muted-foreground">
        {q && q.kind !== 'text' && text ? `${label}: ${text}` : (text ?? label)}
      </span>
    </>
  );
  const cls = cn('border-s-2 border-primary/50 ps-2 text-start', className);
  if (variant === 'bubble' && q) {
    return (
      <button
        type="button"
        data-testid="inbox-quote"
        aria-label={t('jump')}
        onClick={() => jumpToMessage(q.id)}
        className={cn(
          cls,
          'mb-1 block w-full rounded-e bg-black/5 py-0.5 hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-primary dark:bg-white/5 dark:hover:bg-white/10',
        )}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      data-testid={variant === 'bubble' ? 'inbox-quote' : 'inbox-reply-preview'}
      className={cn(cls, variant === 'bubble' && 'mb-1')}
    >
      {body}
    </div>
  );
}
