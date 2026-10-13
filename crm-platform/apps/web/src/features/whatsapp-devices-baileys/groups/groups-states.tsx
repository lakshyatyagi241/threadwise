'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Card } from '@crm/ui';
import { clock } from './groups-model';

const NS = 'whatsapp-devices-baileys.groups.state';

/** The workspace has no personal number yet: the way to add one. */
export function NoDeviceState() {
  const t = useTranslations(`${NS}.noDevice`);
  return (
    <Card className="p-6 text-center" data-testid="groups-state-noDevice">
      <p className="text-xl font-semibold">{t('title')}</p>
      <p className="mt-2 text-sm text-muted-foreground">{t('message')}</p>
      <Link href="/devices" className="mt-3 inline-block text-sm underline">
        {t('connect')}
      </Link>
    </Card>
  );
}

/** The operator switched the unofficial engine off for this workspace (WA_UNOFFICIAL_DISABLED), or the role may not read groups. */
export function BlockedState({ kind }: { kind: 'gateOff' | 'denied' }) {
  const t = useTranslations(`${NS}.${kind}`);
  return (
    <Card className="p-6" data-testid={`groups-state-${kind}`}>
      <p className="text-xl font-semibold">{t('title')}</p>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t('message')}</p>
    </Card>
  );
}

/**
 * The number is not connected, or no worker holds its session: the stored groups stay readable, nothing that reaches WhatsApp can be
 * done. A normal view, not an error.
 */
export function OfflineNote({
  reason,
  deviceId,
  canOpen,
}: {
  reason: 'not_connected' | 'worker_unavailable';
  deviceId: string;
  canOpen: boolean;
}) {
  const t = useTranslations(`${NS}.offline`);
  return (
    <Alert tone="warning" data-testid={`groups-offline-${reason}`}>
      <p className="font-medium">{t(`${reason}.title`)}</p>
      <p className="mt-0.5 text-xs">{t(`${reason}.message`)}</p>
      {reason === 'not_connected' && canOpen && (
        <Link href={`/devices/${deviceId}`} className="mt-1 inline-block text-xs underline">
          {t('open')}
        </Link>
      )}
    </Alert>
  );
}

/** The throttle is holding the number's group actions back: a live countdown, and why. */
export function RateLimitBanner({ waitSeconds }: { waitSeconds: number }) {
  const t = useTranslations(`${NS}.rateLimited`);
  if (waitSeconds <= 0) return null;
  return (
    <Alert tone="warning" data-testid="groups-rate-limited">
      <p className="font-medium">{t('title')}</p>
      <p className="mt-0.5 text-xs">
        {t('message')}{' '}
        <span className="font-semibold tabular-nums" dir="ltr" data-testid="groups-countdown">
          {t('countdown', { time: clock(waitSeconds) })}
        </span>
      </p>
    </Alert>
  );
}
