'use client';

import { useTranslations } from 'next-intl';
import type { LeadFirstReplyResponse } from '@crm/contracts';
import { Badge } from '@crm/ui';
import { FIRST_REPLY_TONE, knownReason, momentOf } from '../lib/first-reply-view';
import { When } from './ui';

/**
 * Where a lead's automatic first message stands (speed-to-lead): the channel, a status chip, why when it did not go (held, blocked,
 * skipped, failed), and when it is due or when it left. Never the message, never an address.
 */
export function FirstReply({ reply }: { reply: LeadFirstReplyResponse }) {
  const t = useTranslations('lead-sources.firstReply');
  const tc = useTranslations('lead-sources.form.speed.channels');
  const reason = knownReason(reply.reason);
  const moment = momentOf(reply);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="first-reply">
      <span className="text-sm">{tc(reply.channel)}</span>
      <Badge tone={FIRST_REPLY_TONE[reply.status]} data-status={reply.status}>
        {t(`status.${reply.status}`)}
      </Badge>
      {reason && <span className="text-xs text-muted-foreground">{t(`reasons.${reason}`)}</span>}
      {moment && (
        <span className="text-xs text-muted-foreground">
          {moment.kind === 'due' ? t('nextTry') : t('sentAt')} <When value={moment.at} empty="-" />
        </span>
      )}
    </span>
  );
}
