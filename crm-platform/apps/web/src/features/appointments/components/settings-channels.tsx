'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { AppointmentChannel, AppointmentChannelState } from '@crm/contracts';
import { Alert, Badge, Select, Spinner, Switch, cn, useToast } from '@crm/ui';
import { KEYS, useAppointmentChannels } from '../api/hooks';
import { channelsApi } from '../api/channels-service';
import { errorKind } from '../lib/errors';
import { CHANNEL_ORDER, CONNECT_HREF, useOf } from '../lib/channel-availability';
import { ErrorLine, useAppointmentsCan } from './parts';
import { SettingsCard } from './settings-parts';

/**
 * Which channels may carry appointment messages (BL-350), on the Appointment settings page. The owner (or an admin) switches email,
 * WhatsApp and SMS on or off and may pick the default sender of a channel; a booking type then lists only the channels that are on AND
 * connected. The outbound reminder call is listed and cannot be switched on until the Voice bot exists.
 */
export function ChannelsSection() {
  const t = useTranslations('appointments.channels');
  const can = useAppointmentsCan();
  const query = useAppointmentChannels();
  const states = query.data;
  const undecided = states !== undefined && states.every((s) => !s.decided || s.channel === 'voice');

  return (
    <SettingsCard id="channels" title={t('title')} description={t('description')}>
      {query.isPending ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : query.isError || !states ? (
        <ErrorLine error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {undecided && (
            <Alert tone="warning" className="text-sm">
              {can.manageChannels ? t('undecidedOwner') : t('undecidedMember')}
            </Alert>
          )}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {CHANNEL_ORDER.map((channel) => {
              const state = states.find((s) => s.channel === channel);
              return state ? (
                <li key={channel}>
                  <ChannelRow state={state} canEdit={can.manageChannels} />
                </li>
              ) : null;
            })}
          </ul>
          {!can.manageChannels && <p className="text-xs text-muted-foreground">{t('readOnly')}</p>}
        </>
      )}
    </SettingsCard>
  );
}

function ChannelRow({ state, canEdit }: { state: AppointmentChannelState; canEdit: boolean }) {
  const t = useTranslations('appointments.channels');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const channel: AppointmentChannel = state.channel;
  const use = useOf(state);
  const href = CONNECT_HREF[channel];
  const soon = use === 'coming_soon';

  async function save(patch: { enabled: boolean; defaultSenderId?: string | null }) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await channelsApi.updateChannel(channel, patch);
      qc.setQueryData<AppointmentChannelState[]>(KEYS.channels, (cur) =>
        cur?.map((s) => (s.channel === next.channel ? next : s)),
      );
      // A booking type's editor and the reminder rules read the same state.
      void qc.invalidateQueries({ queryKey: KEYS.channels });
      toast(
        patch.defaultSenderId !== undefined
          ? t('senderSaved', { channel: t(`names.${channel}`) })
          : patch.enabled
            ? t('switchedOn', { channel: t(`names.${channel}`) })
            : t('switchedOff', { channel: t(`names.${channel}`) }),
      );
    } catch (e) {
      setError(e);
      if (errorKind(e) === 'conflict') void qc.invalidateQueries({ queryKey: KEYS.channels });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn('space-y-2 p-3 sm:p-4', soon && 'bg-muted/30')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{t(`names.${channel}`)}</span>
            <StatusBadge use={use} enabled={state.enabled} decided={state.decided} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t(`about.${channel}`)}</p>
        </div>
        <Switch
          id={`appt-channel-${channel}`}
          checked={state.enabled}
          disabled={!canEdit || saving || soon}
          label={t('enableLabel', { channel: t(`names.${channel}`) })}
          onCheckedChange={(on) => void save({ enabled: on })}
        />
      </div>

      {soon ? (
        <p className="text-xs text-muted-foreground">{t('voiceSoon')}</p>
      ) : (
        <>
          {use === 'not_connected' && href && (
            <p className="text-xs">
              <span className="text-muted-foreground">{t('notConnected')} </span>
              <Link href={href} className="font-medium text-primary underline-offset-2 hover:underline">
                {t('connect')}
              </Link>
            </p>
          )}
          {state.connection === 'not_connected' && !state.enabled && href && (
            <p className="text-xs">
              <Link href={href} className="font-medium text-primary underline-offset-2 hover:underline">
                {t('connect')}
              </Link>
            </p>
          )}
          {state.senders.length > 1 && (
            <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{t('defaultSender')}</span>
              <Select
                value={state.defaultSenderId ?? ''}
                disabled={!canEdit || saving}
                aria-label={t('defaultSenderOf', { channel: t(`names.${channel}`) })}
                onChange={(e) =>
                  void save({ enabled: state.enabled, defaultSenderId: e.target.value || null })
                }
                className="h-9 w-64 max-w-full"
              >
                <option value="">{t('firstConnected')}</option>
                {state.senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {state.senders.length === 1 && (
            <p className="text-xs text-muted-foreground">
              {t('sendsFrom', { sender: state.senders[0]!.label })}
            </p>
          )}
        </>
      )}
      {error !== null && <ErrorLine error={error} />}
    </div>
  );
}

function StatusBadge({
  use,
  enabled,
  decided,
}: {
  use: ReturnType<typeof useOf>;
  enabled: boolean;
  decided: boolean;
}) {
  const t = useTranslations('appointments.channels');
  if (use === 'coming_soon') return <Badge tone="neutral">{t('status.coming_soon')}</Badge>;
  if (use === 'usable') return <Badge tone="success">{t('status.usable')}</Badge>;
  if (use === 'not_connected') return <Badge tone="warning">{t('status.not_connected')}</Badge>;
  return <Badge tone="neutral">{decided && !enabled ? t('status.off') : t('status.notChosen')}</Badge>;
}
