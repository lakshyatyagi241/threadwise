'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { WabaConnection } from '@crm/contracts';
import { Badge, Button, Card } from '@crm/ui';
import { cardTitle, isOnPremise, metaManagerUrl, qualityTone, tierLabel } from '../lib/display';
import { InboundBadge } from './inbound-badge';

export type CardAction = 'setPrimary' | 'fixInbound' | 'register' | 'disconnect' | 'remove';

interface Props {
  conn: WabaConnection;
  busy: boolean;
  onAction: (action: CardAction, conn: WabaConnection) => void;
}

/** One connected number (TW-WABA-004): identity, quality, tier, state, inbound badge and the per-number actions. */
export function NumberCard({ conn, busy, onAction }: Props) {
  const t = useTranslations('whatsapp-cloud-api-waba.card');
  const none = useTranslations('whatsapp-cloud-api-waba.common')('unknown');
  const format = useFormatter();
  const connected = conn.status === 'connected';
  const onPrem = isOnPremise(conn);
  const tier = tierLabel(conn.messagingLimitTier);
  const quality = conn.qualityRating?.toUpperCase() ?? null;

  const act = (a: CardAction, label: string, variant: 'secondary' | 'danger' = 'secondary') => (
    <Button size="sm" variant={variant} disabled={busy} onClick={() => onAction(a, conn)}>
      {label}
    </Button>
  );

  return (
    <Card
      className="relative flex flex-col gap-3 p-4"
      data-testid={`waba-card-${conn.id}`}
      data-primary={conn.isPrimary}
    >
      {conn.isPrimary && (
        <Badge tone="success" className="absolute end-3 top-3">
          {t('primary')}
        </Badge>
      )}
      <div className="min-w-0 pe-20">
        <div className="truncate text-base font-semibold">{cardTitle(conn) ?? t('unnamed')}</div>
        <div className="text-sm text-muted-foreground" dir="ltr">
          {conn.phoneNumber ?? t('unknownPhone')}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {conn.coexistence && <Badge tone="neutral">{t('coexistence')}</Badge>}
          <Badge tone="neutral">{conn.provider === 'interakt' ? 'Interakt' : 'Meta'}</Badge>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t('wabaId')}</dt>
        <dd className="truncate font-mono text-xs" dir="ltr">
          {conn.wabaId ?? none}
        </dd>
        <dt className="text-muted-foreground">{t('phoneId')}</dt>
        <dd className="truncate font-mono text-xs" dir="ltr">
          {conn.phoneNumberId ?? none}
        </dd>
        <dt className="text-muted-foreground">{t('quality')}</dt>
        <dd>
          <Badge tone={qualityTone(quality)}>
            {quality ? quality.charAt(0) + quality.slice(1).toLowerCase() : t('unrated')}
          </Badge>
        </dd>
        <dt className="text-muted-foreground">{t('tier')}</dt>
        <dd>{tier ? t('perDay', { tier }) : none}</dd>
      </dl>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {onPrem ? (
          <Badge tone="danger" title={t('notOnCloudHint')}>
            {t('notOnCloud')}
          </Badge>
        ) : (
          <Badge
            tone={
              connected
                ? 'success'
                : conn.status === 'disconnected' || conn.status === 'failed'
                  ? 'danger'
                  : 'warning'
            }
          >
            {t(conn.status)}
          </Badge>
        )}
        {connected && conn.connectedAt && (
          <span className="text-xs text-muted-foreground">
            {t('connectedAt', {
              when: format.relativeTime(new Date(conn.connectedAt), new Date()),
            })}
          </span>
        )}
        {connected && <InboundBadge wired={conn.inboundWired} />}
      </div>
      {conn.lastError && !connected && (
        <p className="text-xs text-danger">{t('lastError', { error: conn.lastError })}</p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {!conn.isPrimary && connected && act('setPrimary', t('action.setPrimary'))}
        <Link
          href={`/channels/whatsapp/${conn.id}/health`}
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
        >
          {t('action.health')}
        </Link>
        {connected && act('fixInbound', t('action.fixInbound'))}
        {!conn.coexistence && act('register', t('action.register'))}
        {conn.wabaId && (
          <a
            href={metaManagerUrl(conn.wabaId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            {t('action.meta')}
          </a>
        )}
        {connected && act('disconnect', t('action.disconnect'), 'danger')}
        {act('remove', t('action.remove'), 'danger')}
      </div>
    </Card>
  );
}
