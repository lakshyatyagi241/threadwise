'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { MessageLogEvent } from '@crm/contracts';
import { logEventKey, isIgnored, isProblem } from '../lib/message-log';
import { exactStamp } from '../lib/time';

/** The steps of a message's delivery log, oldest first (the delivery log window and the Message History drawer both draw it). */
export function MessageLogTimeline({ events }: { events: readonly MessageLogEvent[] }) {
  return (
    <ol className="space-y-0">
      {events.map((e, i) => (
        <LogLine key={`${e.at}-${i}`} event={e} last={i === events.length - 1} />
      ))}
    </ol>
  );
}

function LogLine({ event: e, last }: { event: MessageLogEvent; last: boolean }) {
  const t = useTranslations('team-inbox-conversations.log');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const key = logEventKey(e);
  const problem = isProblem(e);
  const ignored = isIgnored(e);
  return (
    <li
      data-testid="message-log-event"
      data-event={e.event}
      data-source={e.source}
      className={cn('relative flex gap-3 pb-4', ignored && 'opacity-60')}
    >
      <span className="relative flex w-3 shrink-0 justify-center" aria-hidden>
        <span
          className={cn(
            'z-10 mt-1.5 size-2.5 rounded-full',
            problem ? 'bg-danger' : e.source === 'provider' ? 'bg-primary' : 'bg-muted-foreground',
          )}
        />
        {!last && <span className="absolute inset-y-3 w-px bg-border" />}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className={cn('font-medium', problem && 'text-danger')}>
          {t(`event.${key}`, { attempt: e.attempt ?? 1 })}
        </p>
        <p className="text-xs text-muted-foreground">
          <time dateTime={e.at}>{exactStamp(e.at, locale, timeZone)}</time>
          {' · '}
          {t(`source.${e.source}`)}
        </p>
        {e.event === 'failed' && (e.errorCode || e.errorMessage) && (
          <p className="break-words text-xs text-danger">
            {e.errorCode && <span className="font-mono">{e.errorCode}</span>}
            {e.errorCode && e.errorMessage ? ' · ' : ''}
            {e.errorMessage}
          </p>
        )}
        {e.event === 'retry' && e.detail.manual !== true && e.errorMessage && (
          <p className="break-words text-xs text-muted-foreground">{e.errorMessage}</p>
        )}
        {e.providerMessageId && (e.event === 'sent' || e.event === 'failed') && (
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            {e.providerMessageId}
          </p>
        )}
        {ignored && <p className="text-xs italic text-muted-foreground">{t('notApplied')}</p>}
        {e.replayed === true && (
          <p className="text-xs italic text-muted-foreground">{t('replayed')}</p>
        )}
        {e.event === 'retry' && typeof e.detail.previousProviderMessageId === 'string' && (
          <p className="text-xs text-muted-foreground">{t('resent')}</p>
        )}
      </div>
    </li>
  );
}
