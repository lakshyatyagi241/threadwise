'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { PersonalDevice, WaDeviceGroupStats, WaDeviceGroupsState } from '@crm/contracts';
import { Badge, Card, cn } from '@crm/ui';
import { isOnline } from './groups-model';

/**
 * The left rail: the numbers of the workspace (a group belongs to ONE number), each with its online or offline dot, the limits left on
 * the number on show, a hint when the number is not an admin of some groups, and the plain notes on how groups work.
 */
export function GroupNumberRail({
  device,
  devices,
  state,
  stats,
}: {
  device: PersonalDevice | null;
  devices: readonly PersonalDevice[];
  state: WaDeviceGroupsState | undefined;
  stats: WaDeviceGroupStats | undefined;
}) {
  const t = useTranslations('whatsapp-devices-baileys.groups.rail');
  const notAdmin = stats ? Math.max(0, stats.groups - stats.admin - stats.left) : 0;
  const limits = state?.limits;
  return (
    <aside className="space-y-3" data-testid="groups-rail">
      <Card className="p-2">
        <p className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('title')}
        </p>
        {devices.length === 0 && (
          <p className="px-2 pb-2 text-sm text-muted-foreground">{t('noNumber')}</p>
        )}
        {devices.map((d) => {
          const online = isOnline(d);
          return (
            <Link
              key={d.id}
              href={`/devices/groups?device=${d.id}`}
              aria-current={device?.id === d.id ? 'page' : undefined}
              data-device={d.id}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-2 text-sm',
                device?.id === d.id ? 'bg-muted font-semibold' : 'hover:bg-muted',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  online ? 'bg-success' : 'bg-muted-foreground/50',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate" dir="auto">
                  {d.name}
                </span>
                <span
                  className="block truncate text-xs font-normal text-muted-foreground"
                  dir="ltr"
                >
                  {d.phone}
                </span>
              </span>
              <Badge tone={online ? 'success' : 'neutral'} data-online={online}>
                {online ? t('online') : t('offline')}
              </Badge>
            </Link>
          );
        })}
      </Card>

      {device && notAdmin > 0 && (
        <p
          className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
          data-testid="groups-not-admin-hint"
        >
          {t('notAdminHint', { count: notAdmin })}
        </p>
      )}

      {limits && (
        <Card className="p-4 text-xs" data-testid="groups-limits">
          <p className="font-medium uppercase tracking-wide text-muted-foreground">
            {t('limitsTitle')}
          </p>
          <dl className="mt-2 space-y-1">
            <Limit label={t('limitMinute')} c={limits.opsPerMinute} />
            <Limit label={t('limitDay')} c={limits.opsPerDay} />
            <Limit label={t('limitCreates')} c={limits.createsPerDay} />
            {state?.joinByLinkEnabled && (
              <Limit label={t('limitJoins')} c={limits.joinByLinkPerDay} />
            )}
          </dl>
          <p className="mt-2 text-muted-foreground">
            {t('perCall', { count: limits.participantsPerCall })}
          </p>
        </Card>
      )}

      <div className="rounded-md border border-warning/30 bg-warning/5 p-4 text-sm leading-relaxed">
        <p className="mb-1 font-semibold">{t('howTitle')}</p>
        <p className="text-muted-foreground">{t('howRisk')}</p>
        <p className="mt-2 text-muted-foreground">{t('howAdmin')}</p>
        <p className="mt-2 text-muted-foreground">{t('howInbox')}</p>
      </div>
    </aside>
  );
}

function Limit({ label, c }: { label: string; c: { limit: number; remaining: number } }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums" dir="ltr">
        {c.remaining} / {c.limit}
      </dd>
    </div>
  );
}
