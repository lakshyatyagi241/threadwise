'use client';

import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { MarketConnectionView } from '@crm/contracts';
import { Alert, Button, Input, Spinner } from '@crm/ui';
import { syncInstallation } from '../api';
import {
  listText,
  maskedAddress,
  pullErrorHint,
  senderFormats,
  senderMethods,
  syncNote,
  type InboundView,
  type SenderFormat,
  type SyncNote,
} from '../lib/portals';
import { useAsyncAction } from './use-async-action';

/**
 * The parts of the manage page's connection panel that exist for the lead-portal listings: the masked private address, the
 * "waiting for the first lead" notice, the hint after a polled connection stopped on an error, and "Sync now".
 */

/** The address of a connection whose secret is its last segment: only the end of the secret is known here, the rest was shown once. */
export function PathInboundBlock({ inbound }: { inbound: InboundView }) {
  const t = useTranslations('marketplace.portals.connection.path');
  const tf = useTranslations('marketplace.portals.formats');
  const locale = useLocale();
  const methods = senderMethods(inbound);
  const formats = senderFormats(inbound);
  const formatLabel = (f: SenderFormat) => tf(f);
  return (
    <div
      className="space-y-3 rounded-md border border-border p-3 text-sm"
      data-testid="path-inbound"
    >
      <div className="space-y-1.5">
        <label htmlFor="mkt-inbound-masked" className="block font-medium">
          {t('address')}
        </label>
        <Input
          id="mkt-inbound-masked"
          readOnly
          dir="ltr"
          value={maskedAddress(inbound.url, inbound.secretHint)}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">{t('maskedNote')}</p>
      </div>
      <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
        <li>{t('method', { methods: listText(methods, locale, 'disjunction') })}</li>
        <li>
          {t('formats', { formats: listText(formats.map(formatLabel), locale, 'conjunction') })}
        </li>
        <li>{t('noHeader')}</li>
      </ul>
      <p className="text-muted-foreground">{t('newAddressHint')}</p>
    </div>
  );
}

/** A portal that sends its leads to us has not sent one yet: its own team has to switch the delivery on. */
export function WaitingForFirstLead({ portal }: { portal: string }) {
  const t = useTranslations('marketplace.portals.connection.waiting');
  return (
    <Alert tone="info" data-testid="waiting-first-lead">
      <p className="font-medium">{t('title', { portal })}</p>
      <p>{t('message', { portal })}</p>
    </Alert>
  );
}

/** After a polled connection stopped on an error the key is usually the cause: say where to enter it again and what else to press. */
export function PullErrorHint({
  connection,
  canSync,
}: {
  connection: Pick<MarketConnectionView, 'type' | 'status'>;
  canSync: boolean;
}) {
  const t = useTranslations('marketplace.portals.connection');
  const hint = pullErrorHint(connection, canSync);
  if (!hint) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="pull-error-hint">
      {hint === 'withSync' ? t('errorHint') : t('errorHintNoSync')}
    </p>
  );
}

// --- sync now -----------------------------------------------------------------------------------------------------------------------

/** One "Sync now" call: pending, the server's error (shown through the usual problem notice), and what to tell the person on success. */
export function useSyncNow(installationId: string, onSynced: () => void) {
  const action = useAsyncAction();
  const [note, setNote] = useState<SyncNote | null>(null);
  const run = async () => {
    setNote(null);
    const out = await action.run(() => syncInstallation(installationId));
    if (!out.ok) return;
    // Worked out once, at the moment of the answer: "in 3 minutes" must not drift every time the panel draws again.
    setNote(syncNote(out.value, Date.now()));
    onSynced();
  };
  return { run, pending: action.pending, error: action.error, note };
}
export type SyncNow = ReturnType<typeof useSyncNow>;

export function SyncNowButton({ sync }: { sync: SyncNow }) {
  const t = useTranslations('marketplace.portals.sync');
  return (
    <Button variant="secondary" onClick={() => void sync.run()} disabled={sync.pending}>
      {sync.pending && <Spinner />}
      {t('button')}
    </Button>
  );
}

/** "Sync scheduled for 3:05 PM", and, when the portal's minimum gap between two requests has not passed, that the sync has to wait for it. */
export function SyncFeedback({ note }: { note: SyncNote | null }) {
  const t = useTranslations('marketplace.portals.sync');
  const f = useFormatter();
  if (!note) return null;
  const time = f.dateTime(note.runAt, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Alert tone="success" data-testid="sync-result">
      {note.immediate ? (
        <p className="font-medium">{t('scheduledNow')}</p>
      ) : (
        <>
          <p className="font-medium">{t('scheduled', { time })}</p>
          <p>
            {t('waits', {
              interval: t(`duration.${note.interval.unit}`, { count: note.interval.count }),
            })}
          </p>
        </>
      )}
    </Alert>
  );
}
