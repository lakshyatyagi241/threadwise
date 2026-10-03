'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { channelState } from '../../lib/status';

/** Where each kind of channel is managed. WhatsApp has its own screen; everything else is listed on the inbox's channel list. */
export const channelSettingsHref = (kind: string): string =>
  kind === 'whatsapp_cloud' ? '/channels/whatsapp' : '/inbox/channels';

export interface ReconnectBannerProps {
  channel: { name: string; kind: string; status: string };
  /** The person may open the channel settings (`inbox.channel.manage`); others are told to ask. */
  canManage: boolean;
  className?: string;
}

/**
 * Shown above the composer of a conversation whose channel cannot send: the token was refused (needs reconnecting), the number
 * is in an error state, or it was switched off. It says which, why replies are off, and where to fix it. Renders nothing for a
 * connected channel. The composer is disabled by the thread itself; this is the explanation.
 */
export function ReconnectBanner({ channel, canManage, className }: ReconnectBannerProps) {
  const t = useTranslations('channel-whatsapp-cloud.inbox.reconnect');
  const state = channelState(channel.status);
  if (state === 'connected') return null;
  return (
    <div
      role="status"
      data-testid="inbox-channel-banner"
      data-state={state}
      className={cn(
        'flex items-start gap-2 border-t px-4 py-2.5 text-sm',
        state === 'error'
          ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-warning/30 bg-warning/10 text-warning',
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      >
        <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
      <div className="min-w-0">
        <p className="font-medium">{t(`${state}.title`)}</p>
        <p className="text-xs">
          {t(`${state}.message`, { name: channel.name })}{' '}
          {canManage ? (
            <Link
              href={channelSettingsHref(channel.kind)}
              data-testid="inbox-channel-banner-link"
              className="font-medium underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('open')}
            </Link>
          ) : (
            t('askAdmin')
          )}
        </p>
      </div>
    </div>
  );
}

/** The line under the closed-window banner: free-form replies are over for now, and the template send is not built yet. */
export function TemplatesSoon() {
  const t = useTranslations('channel-whatsapp-cloud.inbox');
  return (
    <p data-testid="inbox-templates-soon" className="mt-1 text-xs opacity-90">
      {t('templatesSoon')}
    </p>
  );
}
