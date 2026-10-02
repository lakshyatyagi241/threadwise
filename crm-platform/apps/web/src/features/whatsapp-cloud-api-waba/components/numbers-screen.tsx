'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ConnectResult, WabaConnection } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, EmptyState, Field, Input, Modal, Spinner } from '@crm/ui';
import {
  useDisconnect,
  useNumbers,
  useReadiness,
  useRegister,
  useRemove,
  useResubscribe,
  useSetPrimary,
} from '../api/hooks';
import { cardTitle } from '../lib/display';
import { ConnectEmbeddedModal } from './connect-embedded-modal';
import { ConnectManualModal } from './connect-manual-modal';
import { NumberCard, type CardAction } from './number-card';
import { useErrorText } from './use-error-text';
import { useFacebookSdk } from './use-facebook-sdk';

type Notice = {
  tone: 'success' | 'warning' | 'danger';
  text: string;
  items?: string[];
  requestId?: string;
};

/** WD-WABA-004: the workspace's WABA numbers, with the connect modals and the per-number actions. */
export function NumbersScreen() {
  const t = useTranslations('whatsapp-cloud-api-waba.numbers');
  const tc = useTranslations('whatsapp-cloud-api-waba');
  const errorText = useErrorText();
  const list = useNumbers();
  const readiness = useReadiness();
  const { fb, failed: sdkFailed } = useFacebookSdk(readiness.data);

  const setPrimary = useSetPrimary();
  const resubscribe = useResubscribe();
  const register = useRegister();
  const disconnect = useDisconnect();
  const remove = useRemove();

  const [modal, setModal] = useState<'embedded' | 'manual' | null>(null);
  const [pending, setPending] = useState<{ action: CardAction; conn: WabaConnection } | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const items = list.data?.items ?? [];
  const embeddedReady = readiness.data?.embeddedSignupReady === true;
  const busy =
    setPrimary.isPending ||
    resubscribe.isPending ||
    register.isPending ||
    disconnect.isPending ||
    remove.isPending;
  const name = (c: WabaConnection) => cardTitle(c) ?? tc('card.unnamed');

  const open = (kind: 'embedded' | 'manual') =>
    setModal(kind === 'embedded' && !embeddedReady ? 'manual' : kind);
  const fail = (e: unknown) => {
    const et = errorText(e);
    setNotice({ tone: 'danger', text: et.text, requestId: et.requestId });
  };

  const onConnected = (r: ConnectResult) => {
    setModal(null);
    setNotice(
      r.warnings.length
        ? { tone: 'warning', text: t('notice.warningsTitle'), items: r.warnings }
        : { tone: 'success', text: t('notice.connected', { name: name(r.connection) }) },
    );
  };

  const run = (p: { action: CardAction; conn: WabaConnection }, extra?: { pin?: string }) => {
    const { action, conn } = p;
    const done =
      (key: 'primary' | 'resubscribed' | 'registered' | 'disconnected' | 'removed') => () => {
        setPending(null);
        setPin('');
        setNotice({ tone: 'success', text: t(`notice.${key}`, { name: name(conn) }) });
      };
    const opts = (key: Parameters<typeof done>[0]) => ({
      onSuccess: done(key),
      onError: (e: unknown) => {
        setPending(null);
        fail(e);
      },
    });
    if (action === 'setPrimary') setPrimary.mutate(conn.id, opts('primary'));
    else if (action === 'fixInbound')
      resubscribe.mutate(conn.id, {
        onSuccess: (r) => {
          setPending(null);
          setNotice(
            r.warnings.length
              ? { tone: 'warning', text: t('notice.warningsTitle'), items: r.warnings }
              : { tone: 'success', text: t('notice.resubscribed', { name: name(conn) }) },
          );
        },
        onError: opts('resubscribed').onError,
      });
    else if (action === 'register')
      register.mutate({ id: conn.id, pin: extra?.pin }, opts('registered'));
    else if (action === 'disconnect') disconnect.mutate(conn.id, opts('disconnected'));
    else remove.mutate(conn.id, opts('removed'));
  };

  const onAction = (action: CardAction, conn: WabaConnection) => {
    setNotice(null);
    // Set primary has no confirmation in WaDesk; everything else asks first (Register asks for a PIN).
    if (action === 'setPrimary') run({ action, conn });
    else {
      setPin('');
      setPinError(false);
      setPending({ action, conn });
    }
  };

  const submitRegister = () => {
    if (pin && !/^\d{6}$/.test(pin)) return setPinError(true);
    if (pending) run(pending, { pin: pin || undefined });
  };

  const confirmKey = pending && pending.action !== 'register' ? pending.action : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('workspace')}
          </div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          {items.length > 0 && (
            <p className="text-sm text-muted-foreground">{t('count', { count: items.length })}</p>
          )}
        </div>
        {items.length > 0 && (
          <Button onClick={() => open(embeddedReady ? 'embedded' : 'manual')}>{t('add')}</Button>
        )}
      </header>

      {notice && (
        <Alert tone={notice.tone} onClick={undefined}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div>{notice.text}</div>
              {notice.items && (
                <ul className="mt-1 list-disc ps-5">
                  {notice.items.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {notice.requestId && (
                <div className="mt-1 text-xs opacity-80">
                  {tc('common.requestId', { id: notice.requestId })}
                </div>
              )}
            </div>
            <button type="button" className="text-xs underline" onClick={() => setNotice(null)}>
              {tc('common.dismiss')}
            </button>
          </div>
        </Alert>
      )}

      {readiness.data && !embeddedReady && (
        <Alert>
          <strong>{t('notReady.title')}.</strong>{' '}
          {readiness.data.missing.length
            ? t('notReady.message', {
                missing: readiness.data.missing
                  .map((m) => (t.has(`missingNames.${m}`) ? t(`missingNames.${m}`) : m))
                  .join(', '),
              })
            : t('notReady.messageGeneric')}
        </Alert>
      )}

      {list.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : list.isError ? (
        <Alert tone="danger">
          {t('loadFailed')}{' '}
          <button type="button" className="underline" onClick={() => list.refetch()}>
            {t('retry')}
          </button>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('empty.title')}
          message={t('empty.message')}
          actions={
            <div className="flex flex-col items-center gap-2">
              <Button onClick={() => open(embeddedReady ? 'embedded' : 'manual')}>
                {embeddedReady ? t('empty.embedded') : t('empty.manual')}
              </Button>
              {embeddedReady && (
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => setModal('manual')}
                >
                  {t('empty.orManual')}
                </button>
              )}
            </div>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2" data-testid="waba-grid">
            {items.map((c) => (
              <NumberCard key={c.id} conn={c} busy={busy} onAction={onAction} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('footerConnected', { count: items.filter((c) => c.status === 'connected').length })}{' '}
            · {t('footerPrimary')}
          </p>
        </>
      )}

      {readiness.data && (
        <ConnectEmbeddedModal
          // A fresh instance per opening, so a cancelled attempt never leaks state into the next one.
          key={modal === 'embedded' ? 'open' : 'closed'}
          open={modal === 'embedded'}
          onClose={() => setModal(null)}
          onSwitchManual={() => setModal('manual')}
          onConnected={onConnected}
          readiness={readiness.data}
          fb={fb}
          sdkFailed={sdkFailed}
        />
      )}
      <ConnectManualModal
        open={modal === 'manual'}
        onClose={() => setModal(null)}
        onConnected={onConnected}
      />

      <ConfirmDialog
        open={confirmKey !== null}
        title={confirmKey ? tc(`card.confirm.${confirmKey}Title`) : ''}
        message={confirmKey ? tc(`card.confirm.${confirmKey}Message`) : ''}
        confirmLabel={confirmKey ? tc(`card.confirm.${confirmKey}`) : ''}
        cancelLabel={tc('common.cancel')}
        tone={confirmKey === 'disconnect' || confirmKey === 'remove' ? 'danger' : 'default'}
        busy={busy}
        onConfirm={() => pending && run(pending)}
        onClose={() => setPending(null)}
      />

      <Modal
        open={pending?.action === 'register'}
        onClose={() => !busy && setPending(null)}
        title={tc('card.registerDialog.title')}
        closeLabel={tc('common.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              {tc('common.cancel')}
            </Button>
            <Button onClick={submitRegister} disabled={busy}>
              {tc('card.registerDialog.submit')}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">{tc('card.registerDialog.message')}</p>
        <Field
          label={tc('card.registerDialog.pin')}
          htmlFor="waba-pin"
          error={pinError ? tc('card.registerDialog.pinError') : undefined}
        >
          <Input
            id="waba-pin"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''));
              setPinError(false);
            }}
            invalid={pinError}
            dir="ltr"
          />
        </Field>
      </Modal>
    </div>
  );
}
