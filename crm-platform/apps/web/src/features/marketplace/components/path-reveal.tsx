'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Input } from '@crm/ui';
import {
  accountManagerMessage,
  fullAddress,
  listText,
  type SenderFormat,
  type SenderMethod,
} from '../lib/portals';
import type { RevealPayload } from '../lib/secret-reveal';
import { CheckIcon, CopyIcon } from './icons';
import { CopyButton } from './ui';

/**
 * The body of the one-time reveal when the connection's secret is the last part of its address (`auth: 'path'`): the FULL private
 * address with a copy button, exactly how the sender calls it, and a ready-made message for the portal's account manager (the
 * portal's own team switches the delivery on). The address is also the password, so it lives only in the reveal state the parent keeps.
 */
export function PathReveal({ payload }: { payload: RevealPayload }) {
  const t = useTranslations('marketplace.portals.reveal');
  const tf = useTranslations('marketplace.portals.formats');
  const tm = useTranslations('marketplace.portals.message');
  const locale = useLocale();
  const id = useId();

  const address = payload.url ? fullAddress(payload.url, payload.secret) : payload.secret;
  const methods: SenderMethod[] = payload.methods?.length ? payload.methods : ['POST'];
  const formats: SenderFormat[] = payload.formats?.length ? payload.formats : ['json'];
  const portal = payload.portalName?.trim() || t('portalFallback');
  const formatLabel = (f: SenderFormat) => tf(f);
  // Built on the click, so the address is never a prop or a piece of the page: it goes to the clipboard and nowhere else.
  const message = () =>
    accountManagerMessage({ portal, address, methods, formats }, tm, locale, formatLabel);

  return (
    <div className="space-y-4" data-testid="path-reveal">
      <div className="space-y-1.5">
        <label htmlFor={`${id}-address`} className="block text-sm font-medium">
          {t('address')}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={`${id}-address`}
            readOnly
            value={address}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 basis-64 font-mono text-xs"
            dir="ltr"
            spellCheck={false}
            autoComplete="off"
          />
          <CopyButton value={address} label={t('copyAddress')} />
        </div>
      </div>

      <div className="space-y-1.5 text-sm">
        <p className="font-medium">{t('sendTitle')}</p>
        <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
          <li>{t('method', { methods: listText(methods, locale, 'disjunction') })}</li>
          <li>
            {t('formats', { formats: listText(formats.map(formatLabel), locale, 'conjunction') })}
          </li>
          <li>{t('noHeader')}</li>
        </ul>
      </div>

      <div
        className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm"
        data-testid="account-manager"
      >
        <p className="font-medium">{t('managerTitle')}</p>
        <p className="text-muted-foreground">{t('managerIntro', { portal })}</p>
        <CopyTextButton
          getText={message}
          label={t('copyMessage')}
          copiedLabel={t('messageCopied')}
        />
      </div>
    </div>
  );
}

/** A copy button that says what it copies in its own words (the shared one only says "Copy"), with a polite confirmation. */
function CopyTextButton({
  getText,
  label,
  copiedLabel,
}: {
  getText: () => string;
  label: string;
  copiedLabel: string;
}) {
  const tc = useTranslations('marketplace.common');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setState('copied');
      setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('failed');
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => void copy()}>
        {state === 'copied' ? <CheckIcon /> : <CopyIcon />}
        {label}
      </Button>
      <span
        aria-live="polite"
        className={state === 'failed' ? 'text-xs text-danger' : 'text-xs text-muted-foreground'}
      >
        {state === 'copied' ? copiedLabel : state === 'failed' ? tc('copyFailed') : ''}
      </span>
    </div>
  );
}
