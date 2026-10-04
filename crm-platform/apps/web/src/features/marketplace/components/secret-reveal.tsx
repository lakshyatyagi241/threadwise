'use client';

import { useEffect, useId } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Checkbox, Input } from '@crm/ui';
import {
  canDismiss,
  dismiss,
  isBlocking,
  setSaved,
  type RevealPayload,
  type RevealState,
} from '../lib/secret-reveal';
import { WarningIcon } from './icons';
import { PathReveal } from './path-reveal';
import { CopyButton } from './ui';

/**
 * The one-time display of a connection secret and the address to send to (install, and rotate). The secret exists only in the
 * `RevealState` the parent keeps in component state: not in a query cache, a URL or browser storage, and never in the console.
 * It stays on screen until the person ticks "I have saved it" and presses Done; then the state becomes `dismissed` and the
 * component renders nothing, so the secret and the address are gone from the page.
 */
export function SecretReveal({
  state,
  onState,
  doneLabel,
}: {
  state: RevealState;
  onState: (next: RevealState) => void;
  doneLabel: string;
}) {
  const t = useTranslations('marketplace.reveal');
  const tp = useTranslations('marketplace.portals.reveal');
  const id = useId();
  const blocking = isBlocking(state);

  // Closing the tab or reloading with the secret still unsaved loses it for good: ask first. A click on a link (the menu, the header)
  // is a page change the browser does not warn about, so it is asked here, in the capture phase, before the router sees it.
  const leaveConfirm = t('leaveConfirm');
  useEffect(() => {
    if (!blocking) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const clickGuard = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!link || link.getAttribute('target') === '_blank') return;
      if (!window.confirm(leaveConfirm)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', guard);
    document.addEventListener('click', clickGuard, true);
    return () => {
      window.removeEventListener('beforeunload', guard);
      document.removeEventListener('click', clickGuard, true);
    };
  }, [blocking, leaveConfirm]);

  if (state.phase !== 'shown') return null;
  const p = state.payload;
  // `path`: the secret is the last part of the address, so there is one thing to save (the full address), not an address and a secret.
  const path = p.auth === 'path';
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid="secret-reveal"
      className="space-y-4 rounded-md border border-warning/50 bg-background p-4"
    >
      <div>
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {path ? tp('title') : t('title')}
        </h2>
        <Alert tone="warning" className="mt-2 flex items-start gap-2">
          <WarningIcon className="mt-0.5" />
          <span>{path ? tp('warning') : t('warning')}</span>
        </Alert>
      </div>

      {path ? (
        <PathReveal payload={p} />
      ) : (
        <>
          {p.url && (
            <ValueRow
              id={`${id}-url`}
              label={t('address')}
              value={p.url}
              copyLabel={t('copyAddress')}
            />
          )}
          <ValueRow
            id={`${id}-secret`}
            label={t('secret')}
            value={p.secret}
            copyLabel={t('copySecret')}
          />
          <SendHints payload={p} />
        </>
      )}

      <div className="space-y-3 border-t border-border pt-3">
        <Checkbox
          id={`${id}-saved`}
          label={path ? tp('saved') : t('saved')}
          checked={state.saved}
          onChange={(e) => onState(setSaved(state, e.target.checked))}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => onState(dismiss(state))} disabled={!canDismiss(state)}>
            {doneLabel}
          </Button>
          {!state.saved && <span className="text-xs text-muted-foreground">{t('doneHint')}</span>}
        </div>
      </div>
    </section>
  );
}

function ValueRow({
  id,
  label,
  value,
  copyLabel,
}: {
  id: string;
  label: string;
  value: string;
  copyLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 basis-64 font-mono text-xs"
          dir="ltr"
          spellCheck={false}
          autoComplete="off"
        />
        <CopyButton value={value} label={copyLabel} />
      </div>
    </div>
  );
}

/** How a sender uses the secret: which header carries it, or how to sign the body. Header names come from the API. */
function SendHints({ payload }: { payload: RevealPayload }) {
  const t = useTranslations('marketplace.reveal.send');
  const token = payload.auth !== 'hmac' && payload.tokenHeader;
  const signature = payload.auth !== 'token' && payload.signatureHeader;
  if (!token && !signature) return null;
  return (
    <div className="space-y-1.5 text-sm">
      <p className="font-medium">{t('title')}</p>
      <p className="text-muted-foreground">{t('post')}</p>
      <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
        {token && <li>{t('token', { header: payload.tokenHeader ?? '' })}</li>}
        {signature && <li>{t('signature', { header: payload.signatureHeader ?? '' })}</li>}
      </ul>
    </div>
  );
}
