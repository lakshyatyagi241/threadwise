'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Select, Spinner, StatTile } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { useDevices } from '../api/devices';
import { useSyncWaGroups, useWaGroups, useWaGroupsState } from '../api/groups-hooks';
import { useErrorText } from '../components/use-error-text';
import { CreateGroupForm } from './create-group-form';
import { GroupNumberRail } from './group-number-rail';
import { GroupRow } from './group-row';
import { GroupsProvider, useFailHandler, useHold } from './groups-context';
import {
  GROUP_PERMISSIONS,
  isOnline,
  offlineReason,
  pickDevice,
  type GroupNotice,
  type GroupPerms,
} from './groups-model';
import { BlockedState, NoDeviceState, OfflineNote, RateLimitBanner } from './groups-states';
import { JoinByLinkDialog } from './join-by-link-dialog';
import { useGroupsLive } from './use-groups-live';

const fmt = (n: number) => n.toLocaleString('en-US');

const codeOf = (e: unknown): string | undefined => (e instanceof ApiError ? e.code : undefined);

/**
 * The Groups tab of the Unofficial WhatsApp API area (`/devices/groups?device=<number>`): the groups of ONE personal number. The rail
 * lists the numbers (online or offline, the limits left, how groups work); the page has the counters, the create form, join by link
 * (only when the platform allows it), a search and the list. A number that is offline, a throttle hold, an operator switch-off and an
 * empty list are normal views, not errors. Spec: docs/threadwise-port/inventory/whatsapp-personal-groups.md (TW-WAGRP-027..036).
 */
export function GroupsScreen({ deviceId }: { deviceId?: string }) {
  const t = useTranslations('whatsapp-devices-baileys.groups');
  const tc = useTranslations('whatsapp-devices-baileys.common');
  const errorText = useErrorText();
  const canRead = useCan(GROUP_PERMISSIONS.read);
  const canCreate = useCan(GROUP_PERMISSIONS.create);
  const canManage = useCan(GROUP_PERMISSIONS.manage);
  const canLeave = useCan(GROUP_PERMISSIONS.leave);
  const canOpenDevice = useCan('wa.devices.read');
  const perms: GroupPerms = { create: canCreate, manage: canManage, leave: canLeave };

  const devices = useDevices();
  const items = devices.data?.data ?? [];
  const device = pickDevice(items, deviceId);
  const deviceKey = device?.id ?? null;
  const state = useWaGroupsState(deviceKey);

  const [notice, setNotice] = useState<GroupNotice | null>(null);
  const { waitSeconds, hold, holdUntil } = useHold();
  const fail = useFailHandler(setNotice, hold);
  // A cooldown that started elsewhere (a colleague, an earlier visit) is still shown, counted down.
  const cooldownUntil = state.data?.limits.cooldownUntil;
  useEffect(() => holdUntil(cooldownUntil), [cooldownUntil]); // eslint-disable-line react-hooks/exhaustive-deps

  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'left'>('all');
  useEffect(() => {
    const h = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);

  const groups = useWaGroups(deviceKey, { q: debouncedQ || undefined, status }, canRead);
  useGroupsLive(deviceKey);
  const sync = useSyncWaGroups(deviceKey ?? '');
  const rows = groups.data?.pages.flatMap((p) => p.items) ?? [];
  const stats = groups.data?.pages[0]?.stats;

  const online = device ? isOnline(device) : false;
  const offline = device ? (offlineReason(state.data) ?? (online ? null : 'not_connected')) : null;
  const failure = [state.error, groups.error].find((e) => e !== null && e !== undefined);
  const blocked: 'gateOff' | 'denied' | null = !canRead
    ? 'denied'
    : codeOf(failure) === 'WA_UNOFFICIAL_DISABLED'
      ? 'gateOff'
      : codeOf(failure) === 'FORBIDDEN'
        ? 'denied'
        : null;

  return (
    <div className="mx-auto max-w-[1300px] p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <GroupNumberRail device={device} devices={items} state={state.data} stats={stats} />

        <section className="min-w-0 space-y-5">
          <header>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('eyebrow')}
            </p>
            <h1 className="mt-1 text-3xl font-semibold leading-none">
              {t('headingA')} <span className="italic text-primary">{t('headingB')}</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
          </header>

          {notice && (
            <Alert tone={notice.tone}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div>{notice.text}</div>
                </div>
                <button type="button" className="text-xs underline" onClick={() => setNotice(null)}>
                  {tc('dismiss')}
                </button>
              </div>
            </Alert>
          )}

          {devices.isPending ? (
            <Loading label={t('loading')} />
          ) : devices.isError ? (
            <Alert tone="danger">
              {codeOf(devices.error) === 'WA_UNOFFICIAL_DISABLED'
                ? t('state.gateOff.title')
                : t('loadFailed')}{' '}
              <button type="button" className="underline" onClick={() => devices.refetch()}>
                {t('retry')}
              </button>
            </Alert>
          ) : !device ? (
            <NoDeviceState />
          ) : blocked ? (
            <BlockedState kind={blocked} />
          ) : (
            <GroupsProvider value={{ device, online, perms, waitSeconds, notify: setNotice, fail }}>
              <RateLimitBanner waitSeconds={waitSeconds} />
              {offline && (
                <OfflineNote reason={offline} deviceId={device.id} canOpen={canOpenDevice} />
              )}

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="groups-kpis">
                <StatTile
                  label={t('kpi.groups')}
                  value={fmt(stats?.groups ?? 0)}
                  hint={t('kpi.groupsSub')}
                />
                <StatTile
                  label={t('kpi.members')}
                  value={fmt(stats?.members ?? 0)}
                  hint={t('kpi.membersSub')}
                />
                <StatTile
                  label={t('kpi.admin')}
                  value={fmt(stats?.admin ?? 0)}
                  hint={t('kpi.adminSub')}
                />
                <StatTile
                  label={t('kpi.joinRequests')}
                  value={fmt(stats?.joinRequests ?? 0)}
                  hint={t('kpi.joinRequestsSub')}
                  tone={stats && stats.joinRequests > 0 ? 'warning' : 'default'}
                />
                <StatTile
                  label={t('kpi.left')}
                  value={fmt(stats?.left ?? 0)}
                  hint={t('kpi.leftSub')}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canCreate && !creating && (
                  <Button onClick={() => setCreating(true)} data-testid="groups-create-open">
                    {t('create.open')}
                  </Button>
                )}
                {canManage && state.data?.joinByLinkEnabled && (
                  <Button
                    variant="secondary"
                    onClick={() => setJoining(true)}
                    data-testid="groups-join-open"
                  >
                    {t('join.open')}
                  </Button>
                )}
              </div>

              {canCreate && creating && <CreateGroupForm onDone={() => setCreating(false)} />}
              {canManage && state.data?.joinByLinkEnabled && (
                <JoinByLinkDialog open={joining} onClose={() => setJoining(false)} />
              )}

              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                  <p className="text-lg font-semibold">{t('list.title')}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!online || waitSeconds > 0 || sync.isPending}
                      data-testid="groups-sync"
                      onClick={() =>
                        sync.mutate(undefined, {
                          onSuccess: (r) =>
                            setNotice({
                              tone: 'success',
                              text: r.throttled
                                ? t('list.syncThrottled')
                                : t('list.synced', { count: r.groups }),
                            }),
                          onError: fail,
                        })
                      }
                    >
                      {sync.isPending ? t('list.syncing') : t('list.sync')}
                    </Button>
                    <Input
                      type="search"
                      aria-label={t('list.search')}
                      placeholder={t('list.search')}
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      className="w-48"
                    />
                    <Select
                      aria-label={t('list.statusLabel')}
                      value={status}
                      onChange={(e) => setStatus(e.target.value as 'all' | 'active' | 'left')}
                    >
                      <option value="all">{t('list.statusAll')}</option>
                      <option value="active">{t('list.statusActive')}</option>
                      <option value="left">{t('list.statusLeft')}</option>
                    </Select>
                  </div>
                </div>
                {groups.isPending ? (
                  <div className="px-5 py-6">
                    <Loading label={t('loading')} />
                  </div>
                ) : groups.isError ? (
                  <div className="px-5 py-6">
                    <Alert tone="danger">
                      {errorText(groups.error).text}{' '}
                      <button type="button" className="underline" onClick={() => groups.refetch()}>
                        {t('retry')}
                      </button>
                    </Alert>
                  </div>
                ) : rows.length === 0 ? (
                  <div className="px-5 py-10 text-center" data-testid="groups-empty">
                    <p className="text-sm text-muted-foreground">
                      {debouncedQ || status !== 'all' ? t('list.noMatch') : t('list.empty')}
                    </p>
                  </div>
                ) : (
                  <>
                    {rows.map((g) => (
                      <GroupRow key={g.id} group={g} />
                    ))}
                    {groups.hasNextPage && (
                      <div className="px-5 py-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={groups.isFetchingNextPage}
                          onClick={() => groups.fetchNextPage()}
                        >
                          {groups.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </Card>
            </GroupsProvider>
          )}
        </section>
      </div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Spinner /> {label}
    </div>
  );
}
