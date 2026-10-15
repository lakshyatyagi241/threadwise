'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge, Button, ConfirmDialog, EmptyState, Spinner, cn, useToast } from '@crm/ui';
import type { ChannelResponse } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { offerChannels } from '@/lib/unofficial-whatsapp';
import { useUnofficialWhatsapp } from '@/lib/use-unofficial-whatsapp';
import { refreshChannels, useChannels } from '../api/hooks';
import { inboxApi } from '../api/service';
import { errorCode } from '../lib/errors';
import { fullStamp } from '../lib/time';
import { BackIcon } from './icons';
import { ChannelTag, useErrorText } from './parts';

/**
 * The channels the workspace has connected, with their state and what each can do, and (in development) the button that adds
 * the simulated channel. A plain list with no page chrome, so the Settings page can drop it in as it is. Adding a real
 * provider account belongs to the Settings screens; this list only shows them and removes one that has no conversations.
 */
export function ChannelsList({ className }: { className?: string }) {
  const t = useTranslations('team-inbox-conversations.channels');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const manage = useCan('inbox.channel.manage');
  const q = useChannels();
  const [busy, setBusy] = useState(false);
  const [simulatorOff, setSimulatorOff] = useState(false);
  const [toRemove, setToRemove] = useState<ChannelResponse | null>(null);

  // The simulator is a development tool: the production build never offers it, and the API refuses it unless its flag is on.
  const canOfferSimulator = manage && process.env.NODE_ENV !== 'production' && !simulatorOff;

  async function addSimulator() {
    setBusy(true);
    try {
      await inboxApi.createSimulatorChannel({ name: 'Simulator' });
      await refreshChannels(qc);
      toast(t('simulatorAdded'));
    } catch (e) {
      if (errorCode(e) === 'CHANNEL_SIMULATOR_DISABLED') {
        setSimulatorOff(true);
        toast(t('simulatorDisabled'), 'info');
      } else toast(errorText(e), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!toRemove) return;
    setBusy(true);
    try {
      await inboxApi.deleteChannel(toRemove.id);
      setToRemove(null);
      await refreshChannels(qc);
    } catch (e) {
      toast(errorText(e), 'danger');
      setToRemove(null);
    } finally {
      setBusy(false);
    }
  }

  const unofficial = useUnofficialWhatsapp();
  const channels = offerChannels(q.data?.data ?? [], unofficial);

  return (
    <div className={cn('space-y-4', className)} data-testid="inbox-channels">
      {canOfferSimulator && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 p-3">
          <p className="text-sm text-warning">{t('simulatorNote')}</p>
          <Button
            variant="secondary"
            size="sm"
            data-testid="inbox-add-simulator"
            disabled={busy}
            onClick={() => void addSimulator()}
          >
            {busy && <Spinner />}
            {t('addSimulator')}
          </Button>
        </div>
      )}

      {q.isPending && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </p>
      )}
      {q.isError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-danger">
            {t('loadFailed')}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
            {t('retry')}
          </Button>
        </div>
      )}
      {q.isSuccess && channels.length === 0 && (
        <EmptyState title={t('empty.title')} message={t('empty.message')} />
      )}

      <ul className="grid gap-3 md:grid-cols-2" aria-label={t('listLabel')}>
        {channels.map((c) => (
          <li
            key={c.id}
            data-testid="inbox-channel"
            className="space-y-2 rounded-md border border-border bg-background p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  <ChannelTag decorative kind={c.kind} name={c.name} />
                  <span className="truncate">{c.name}</span>
                </p>
                {c.displayAddress && (
                  <p dir="ltr" className="font-mono text-xs text-muted-foreground">
                    {c.displayAddress}
                  </p>
                )}
              </div>
              <Badge
                tone={
                  c.status === 'connected' ? 'success' : c.status === 'error' ? 'danger' : 'warning'
                }
              >
                {t(`status.${c.status}`)}
              </Badge>
            </div>
            <ul className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
              {c.capabilities.windowHours !== null && (
                <li className="rounded-full bg-muted px-2 py-0.5">
                  {t('capWindow', { hours: c.capabilities.windowHours })}
                </li>
              )}
              {c.capabilities.templates && (
                <li className="rounded-full bg-muted px-2 py-0.5">{t('capTemplates')}</li>
              )}
              {c.capabilities.media.length > 0 && (
                <li className="rounded-full bg-muted px-2 py-0.5">{t('capMedia')}</li>
              )}
              {c.capabilities.receipts.length > 0 && (
                <li className="rounded-full bg-muted px-2 py-0.5">{t('capReceipts')}</li>
              )}
            </ul>
            <p className="text-xs text-muted-foreground">
              {c.lastEventAt
                ? t('lastEvent', { when: fullStamp(c.lastEventAt, locale, timeZone) })
                : t('noEvents')}
            </p>
            {manage && (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="inbox-remove-channel"
                  onClick={() => setToRemove(c)}
                >
                  {t('remove')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={toRemove !== null}
        title={t('removeTitle')}
        message={t('removeMessage', { name: toRemove?.name ?? '' })}
        confirmLabel={t('removeConfirm')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => setToRemove(null)}
      />
    </div>
  );
}

/** `/inbox/channels`: the list under a heading with the way back to the inbox. */
export function ChannelsScreen() {
  const t = useTranslations('team-inbox-conversations.channels');
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="space-y-2">
        <Link
          href="/inbox"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <BackIcon width={14} height={14} />
          {t('backToInbox')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <ChannelsList />
    </div>
  );
}
