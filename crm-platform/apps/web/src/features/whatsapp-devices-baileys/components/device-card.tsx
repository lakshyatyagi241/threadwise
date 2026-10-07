'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { PersonalDevice } from '@crm/contracts';
import { Button, Switch } from '@crm/ui';
import { formatWhen, type DevicePerms } from '../lib/format';
import { canDisconnect, primaryAction, type RowAction } from '../lib/state-model';
import { ReasonText, StateBadge } from './state-badge';

export type CardAction = 'link' | 'disconnect' | 'rename' | 'delete';

/** One number: name, status, number, last seen, "Use for sending" and the actions the session may take. */
export function DeviceCard({
  device,
  perms,
  busy,
  onAction,
  onSending,
}: {
  device: PersonalDevice;
  perms: DevicePerms;
  busy: boolean;
  onAction: (action: CardAction, device: PersonalDevice) => void;
  onSending: (device: PersonalDevice, active: boolean) => void;
}) {
  const t = useTranslations('whatsapp-devices-baileys.list');
  const locale = useLocale();
  const action: RowAction = primaryAction(device.connectionState);
  const lastSeen = formatWhen(device.lastSeenAt, locale);
  return (
    <li
      className="space-y-3 rounded-md border border-border bg-background p-4"
      data-testid="device-card"
      data-state={device.connectionState}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/devices/${device.id}`}
            className="block truncate font-semibold hover:underline"
          >
            {device.name}
          </Link>
          <div dir="ltr" className="text-sm text-muted-foreground [unicode-bidi:isolate]">
            {device.phone}
          </div>
        </div>
        <StateBadge state={device.connectionState} />
      </div>

      <ReasonText reason={device.stateReason} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t('columns.lastSeen')}</dt>
        <dd>{lastSeen ?? t('lastSeenNever')}</dd>
        {device.assignee && (
          <>
            <dt className="text-muted-foreground">{t('columns.name')}</dt>
            <dd>{t('assignedTo', { name: device.assignee.name })}</dd>
          </>
        )}
      </dl>

      <div className="flex items-center gap-2 text-sm">
        <Switch
          checked={device.active}
          onCheckedChange={(v) => onSending(device, v)}
          label={t('sendingToggle', { name: device.name })}
          disabled={!perms.create || busy}
        />
        <span>{device.active ? t('sendingOn') : t('sendingOff')}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {action && perms.pair && (
          <Button size="sm" onClick={() => onAction('link', device)} disabled={busy}>
            {t(`action.${action}`)}
          </Button>
        )}
        {canDisconnect(device.connectionState) && perms.disconnect && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onAction('disconnect', device)}
            disabled={busy}
          >
            {t('action.disconnect')}
          </Button>
        )}
        {perms.create && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onAction('rename', device)}
            disabled={busy}
          >
            {t('action.rename')}
          </Button>
        )}
        {perms.delete && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onAction('delete', device)}
            disabled={busy}
          >
            {t('action.delete')}
          </Button>
        )}
        <Link
          href={`/devices/${device.id}`}
          className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium hover:bg-muted"
        >
          {t('action.details')}
        </Link>
      </div>
    </li>
  );
}
