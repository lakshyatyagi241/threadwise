'use client';

import type { ReactNode } from 'react';
import { useFormatter, useLocale, useTimeZone, useTranslations } from 'next-intl';
import { Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useLeadScoringEnabled } from '@/features/lead-scoring';
import { useContactConversations } from '../../api/conversations';
import { useContactCalls, useContactMessageStats, useContactOpenTaskCount } from '../../api/stats';
import { callFigures, conversationFigures } from '../../lib/contact-data';
import { formatDateTime } from '../../lib/format';
import { Panel, type SectionProps } from './shared';

/** One small figure. `wide` is for a date, which reads better in smaller type than a count. */
function Tile({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={
          wide
            ? 'mt-1 break-words text-sm font-semibold'
            : 'mt-1 text-xl font-semibold leading-tight tabular-nums'
        }
      >
        {children}
      </div>
    </div>
  );
}

/**
 * "Communication stats": only figures the API really has per contact, each tile shown only when its source is allowed and has
 * loaded.
 *
 * The WhatsApp counters (sent, delivered, seen, received, failed, replied) are the API's own count over the contact's WhatsApp
 * conversations. The other conversation and message figures come from the inbox conversations found for this contact (`useContactConversations`: searched by phone, e-mail or
 * name, then filtered to this contact id, archived threads left out). Call figures come from the call log filtered the same
 * way over the last year (`useContactCalls`). Open tasks is the contact's own task list. Lead score, last activity and the
 * created date come from the contact itself. A source that is forbidden, off the plan or failing hides its tiles.
 */
export function StatsSection({ contact, variant }: SectionProps) {
  const t = useTranslations('contacts-attributes-tags.contact.stats');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const format = useFormatter();
  const canConversations = useCan('inbox.conversation.read');
  const canCalls = useCan('call.logs.read');
  const canTasks = useCan('record.tasks.read');
  const scoringOn = useLeadScoringEnabled();

  const conversations = useContactConversations(contact, canConversations);
  const calls = useContactCalls(contact, canCalls);
  const tasks = useContactOpenTaskCount(contact.id, canTasks);
  const whatsapp = useContactMessageStats(contact.id, canConversations);

  const when = (iso: string | null) => formatDateTime(iso, locale, timeZone) || t('none');

  const showConversations = canConversations && conversations.isSuccess;
  const figures = conversationFigures(conversations.items);
  const showCalls = canCalls && calls.isSuccess;
  const callTotals = callFigures(calls.rows);
  const showTasks = canTasks && tasks.isSuccess;

  // A source that is refused or fails just shows no tiles (an error leaves `isSuccess` false); only the first load shows the spinner.
  const loading =
    (canConversations && conversations.isPending) ||
    whatsapp.isPending ||
    (canCalls && calls.isPending) ||
    (canTasks && tasks.isPending);

  return (
    <Panel id="contact-stats" title={t('title')} bodyClassName={variant === 'drawer' ? 'px-3' : ''}>
      <div
        className={
          variant === 'drawer'
            ? 'grid grid-cols-2 gap-2'
            : 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4'
        }
      >
        {showConversations && (
          <>
            <Tile label={t('conversations')}>{format.number(figures.count)}</Tile>
            <Tile label={t('unread')}>{format.number(figures.unread)}</Tile>
            <Tile label={t('lastInbound')} wide>
              {when(figures.lastInboundAt)}
            </Tile>
            <Tile label={t('lastOutbound')} wide>
              {when(figures.lastOutboundAt)}
            </Tile>
          </>
        )}
        {whatsapp.stats && (
          <>
            <Tile label={t('waSent')}>{format.number(whatsapp.stats.sent)}</Tile>
            <Tile label={t('waDelivered')}>{format.number(whatsapp.stats.delivered)}</Tile>
            <Tile label={t('waSeen')}>{format.number(whatsapp.stats.seen)}</Tile>
            <Tile label={t('waReceived')}>{format.number(whatsapp.stats.received)}</Tile>
            <Tile label={t('waFailed')}>{format.number(whatsapp.stats.failed)}</Tile>
            <Tile label={t('waReplied')}>{format.number(whatsapp.stats.replied)}</Tile>
          </>
        )}
        {showCalls && (
          <>
            <Tile label={t('calls')}>{format.number(callTotals.total)}</Tile>
            <Tile label={t('callsAnswered')}>{format.number(callTotals.answered)}</Tile>
            <Tile label={t('callsMissed')}>{format.number(callTotals.missed)}</Tile>
            <Tile label={t('callMinutes')}>{format.number(callTotals.minutes)}</Tile>
          </>
        )}
        {showTasks && (
          <Tile label={t('openTasks')}>
            {tasks.more
              ? t('atLeast', { count: format.number(tasks.count) })
              : format.number(tasks.count)}
          </Tile>
        )}
        {scoringOn && contact.leadScore !== null && (
          <Tile label={t('leadScore')}>{format.number(contact.leadScore)}</Tile>
        )}
        <Tile label={t('lastActivity')} wide>
          {when(contact.lastActivityAt)}
        </Tile>
        <Tile label={t('created')} wide>
          {when(contact.createdAt)}
        </Tile>
      </div>
      {loading && (
        <div role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      )}
      {whatsapp.stats && (
        <p className="mt-3 text-xs text-muted-foreground">{t('waFootnote')}</p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t('footnote')}</p>
      {showCalls && calls.partial && (
        <p className="mt-1 text-xs text-muted-foreground">{t('callsPartial')}</p>
      )}
    </Panel>
  );
}
