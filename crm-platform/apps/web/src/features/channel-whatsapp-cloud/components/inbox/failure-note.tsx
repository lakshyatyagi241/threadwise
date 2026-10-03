'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { describeFailure, needsChannelFix } from '../../lib/failure';
import { channelSettingsHref } from './reconnect-banner';

export interface FailureNoteProps {
  failure: { code: string | null; reason: string | null } | null;
  /** The sentence for a failure that carries nothing at all (the inbox's own "not delivered"). */
  fallback: string;
  channelKind?: string;
  canManage?: boolean;
}

/**
 * Why an outbound message did not go, in plain language (the window closed, the number cannot be reached, a rate limit, a token
 * that expired...), chosen by the failure code. A code nobody has mapped shows the provider's own reason. When the cause is the
 * channel, the person who can fix it gets a link to the channel settings.
 */
export function FailureNote({
  failure,
  fallback,
  channelKind = 'whatsapp_cloud',
  canManage = false,
}: FailureNoteProps) {
  const t = useTranslations('channel-whatsapp-cloud.inbox.failure');
  const { kind, reason } = describeFailure(failure);
  const text =
    kind === 'unknown' ? (reason ?? fallback) : `${t(`${kind}.title`)} ${t(`${kind}.hint`)}`;
  return (
    <span
      data-testid="inbox-failure"
      data-kind={kind}
      title={kind === 'unknown' ? undefined : (reason ?? undefined)}
    >
      {text}
      {canManage && needsChannelFix(kind) && (
        <>
          {' '}
          <Link
            href={channelSettingsHref(channelKind)}
            className="font-medium underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-danger"
          >
            {t('openSettings')}
          </Link>
        </>
      )}
    </span>
  );
}
