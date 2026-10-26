'use client';

import { useTranslations } from 'next-intl';
import type { MessageSystemEvent } from '@crm/contracts';
import { botLineKeys } from '../lib/handoff';

type BotEvent = Extract<MessageSystemEvent, { event: 'bot_returned' }>;

/**
 * The staff-only system line that tells the thread the bot is back: who gave the conversation back and whether the flow continues
 * now or the bot answers the next message (written the moment the button is pressed), then, a moment later, what happened to the
 * flow and to the optional message to the customer. Worded in the reader's language; `fallback` (the server's English) is only used
 * when this build does not know the shape of the line.
 */
export function BotReturnedLine({ event, fallback }: { event: BotEvent; fallback: string | null }) {
  const t = useTranslations('team-inbox-conversations.handoff.botLine');
  const keys = botLineKeys(event);
  const text = keys
    .map((k) => t(k, { name: event.by ?? t('system') }))
    .join(' ')
    .trim();
  return (
    <p
      data-testid="inbox-bot-returned-line"
      data-stage={event.stage}
      className="max-w-[80%] rounded-md bg-muted px-3 py-1 text-center text-xs text-muted-foreground"
    >
      {text || fallback}
    </p>
  );
}
