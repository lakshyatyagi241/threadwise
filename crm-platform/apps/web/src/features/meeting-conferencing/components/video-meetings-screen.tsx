'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import {
  ERROR_CODES,
  type ConferencingConnection,
  type ConnectedVideoProvider,
} from '@crm/contracts';
import { Alert, Badge, Button, ConfirmDialog, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { KEYS, conferencingApi, useConferencingConnections } from '../api/conferencing';
import { MARKETPLACE_INTEGRATIONS, VIDEO_MEETINGS_PATH } from '../lib/form-model';
import { readOutcome, safeConsentUrl, withoutOutcome, type Outcome } from '../lib/screen-model';

const CARD = 'rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-5';
const TONE = {
  connected: 'success',
  needs_reconnect: 'danger',
  unavailable: 'warning',
  disconnected: 'neutral',
  not_installed: 'neutral',
  not_available: 'neutral',
} as const;

/**
 * `/settings/video-meetings` (BL-360): a person's own Zoom and Microsoft Teams connections. A card shows what the workspace has installed
 * (the Marketplace listing) and whether this person has connected their own account; Connect sends the browser to the provider, which sends
 * it back here with `?video=<outcome>` (and, when the person said yes, a ticket this page confirms: only the person who pressed Connect
 * can finish it).
 */
export function VideoMeetingsScreen() {
  const t = useTranslations('meeting-conferencing.page');
  const canUse = useCan('record.contacts.update');
  const q = useConferencingConnections(canUse);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('eyebrow')}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      {!canUse && (
        <Alert tone="danger">
          <p className="font-semibold">{t('forbidden.title')}</p>
          <p>{t('forbidden.body')}</p>
        </Alert>
      )}
      {canUse && q.isPending && (
        <div className={cn(CARD, 'flex justify-center p-10')}>
          <Spinner label={t('loading')} />
        </div>
      )}
      {canUse && q.isError && (
        <Alert tone="danger">
          <p>{q.error instanceof ApiError ? q.error.message : t('failure.generic')}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => void q.refetch()}>
            {t('retry')}
          </Button>
        </Alert>
      )}
      {canUse && q.data && <Body cards={q.data.data} canInstall={q.data.canInstall} />}
    </div>
  );
}

function Body({ cards, canInstall }: { cards: ConferencingConnection[]; canInstall: boolean }) {
  const t = useTranslations('meeting-conferencing.page');
  const qc = useQueryClient();
  const params = useSearchParams();
  const initial = readOutcome(`?${params.toString()}`);
  const [outcome, setOutcome] = useState<Outcome | null>(
    initial && initial.kind !== 'confirm' ? initial : null,
  );
  const [confirming, setConfirming] = useState<ConnectedVideoProvider | null>(
    initial?.kind === 'confirm' ? initial.provider : null,
  );
  const ran = useRef(false);

  // The provider sent the browser back with a ticket: finish the connection once, then take the outcome out of the address.
  useEffect(() => {
    if (ran.current) return;
    const o = readOutcome(window.location.search);
    if (!o) return;
    ran.current = true;
    const clean = () =>
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${withoutOutcome(window.location.search)}${window.location.hash}`,
      );
    if (o.kind !== 'confirm') {
      clean();
      return;
    }
    conferencingApi
      .confirm(o.provider, o.ticket)
      .then(() => setOutcome({ kind: 'connected', provider: o.provider }))
      .catch((e: unknown) =>
        setOutcome({
          kind:
            e instanceof ApiError && e.code === ERROR_CODES.CONF_CONFIRM_NOT_YOURS
              ? 'notYours'
              : e instanceof ApiError && e.code === ERROR_CODES.CONF_CONFIRM_INVALID
                ? 'expired'
                : 'failed',
          provider: o.provider,
        }),
      )
      .finally(() => {
        clean();
        setConfirming(null);
        void qc.invalidateQueries({ queryKey: KEYS.connections });
        void qc.invalidateQueries({ queryKey: KEYS.capabilities });
      });
  }, [qc]);

  return (
    <>
      {confirming && (
        <Alert tone="info">
          <Spinner label={t('confirming')} /> {t('confirming')}
        </Alert>
      )}
      {outcome && <OutcomeAlert outcome={outcome} />}
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((c) => (
          <ProviderCard
            key={c.provider}
            card={c}
            canInstall={canInstall}
            onChanged={() => {
              void qc.invalidateQueries({ queryKey: KEYS.connections });
              void qc.invalidateQueries({ queryKey: KEYS.capabilities });
            }}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('calendarNote')}</p>
    </>
  );
}

function OutcomeAlert({ outcome }: { outcome: Outcome }) {
  const t = useTranslations('meeting-conferencing.page');
  const name = t(`providers.${outcome.provider}.name`);
  return (
    <Alert tone={outcome.kind === 'connected' ? 'success' : 'danger'}>
      {t(`outcome.${outcome.kind}`, { provider: name })}
    </Alert>
  );
}

function ProviderCard({
  card,
  canInstall,
  onChanged,
}: {
  card: ConferencingConnection;
  canInstall: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('meeting-conferencing.page');
  const locale = useLocale();
  const { toast } = useToast();
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const name = t(`providers.${card.provider}.name`);

  async function connect() {
    setBusy('connect');
    setError(null);
    try {
      const { url } = await conferencingApi.start(card.provider, VIDEO_MEETINGS_PATH);
      const target = safeConsentUrl(url, window.location.origin);
      if (!target) throw new Error('unsafe consent address');
      window.location.assign(target);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('outcome.failed', { provider: name }));
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    setError(null);
    try {
      await conferencingApi.disconnect(card.provider);
      toast(t('disconnected', { provider: name }));
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('outcome.failed', { provider: name }));
    } finally {
      setConfirmOff(false);
      setBusy(null);
    }
  }

  const connectedOn = card.connectedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(card.connectedAt))
    : null;

  return (
    <section
      aria-label={name}
      className={cn(CARD, 'flex flex-col gap-3')}
      data-testid={`video-card-${card.provider}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{name}</h2>
        <Badge tone={TONE[card.status]}>{t(`status.${card.status}`)}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{t(`providers.${card.provider}.about`)}</p>

      {card.status === 'not_available' && (
        <p className="text-sm text-muted-foreground">{t('notAvailable', { provider: name })}</p>
      )}
      {card.status === 'disconnected' && (
        <p className="text-sm text-muted-foreground">{t('installedHint', { provider: name })}</p>
      )}
      {card.status === 'not_installed' && (
        <>
          <p className="text-sm">
            {t(canInstall ? 'notInstalled.canInstall' : 'notInstalled.cannotInstall', {
              provider: name,
            })}
          </p>
          {canInstall && (
            <Link
              href={card.listingPath ?? MARKETPLACE_INTEGRATIONS}
              className="inline-flex h-9 w-fit items-center rounded-md border border-border px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('actions.install')}
            </Link>
          )}
        </>
      )}
      {card.status === 'unavailable' && (
        <p className="text-sm text-muted-foreground">{t('unavailable', { provider: name })}</p>
      )}
      {(card.status === 'connected' || card.status === 'needs_reconnect') && (
        <div className="space-y-0.5 text-sm text-muted-foreground">
          {card.account && <p dir="ltr">{t('account', { account: card.account })}</p>}
          {connectedOn && <p>{t('connectedOn', { when: connectedOn })}</p>}
          {(card.lastErrorCode === 'forbidden' ||
            card.lastErrorCode === 'rate_limited' ||
            card.lastErrorCode === 'unavailable') && (
            <p className="text-danger">{t(`lastError.${card.lastErrorCode}`)}</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {(card.status === 'disconnected' || card.status === 'needs_reconnect') && (
          <Button onClick={() => void connect()} disabled={busy !== null}>
            {busy === 'connect' && <Spinner />}
            {card.status === 'needs_reconnect' ? t('actions.reconnect') : t('actions.connect')}
          </Button>
        )}
        {(card.status === 'connected' || card.status === 'needs_reconnect') && (
          <Button variant="secondary" onClick={() => setConfirmOff(true)} disabled={busy !== null}>
            {t('actions.disconnect')}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmOff}
        tone="danger"
        busy={busy === 'disconnect'}
        title={t('disconnectTitle', { provider: name })}
        message={t('disconnectBody', { provider: name })}
        confirmLabel={t('disconnectConfirm')}
        cancelLabel={t('keep')}
        onClose={() => setConfirmOff(false)}
        onConfirm={() => void disconnect()}
      />
    </section>
  );
}
