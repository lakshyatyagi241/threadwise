'use client';

import type { InvoiceResponse } from '@crm/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, ConfirmDialog, Field, Input, Modal, Select, Spinner, cn } from '@crm/ui';
import { formatDateTime } from '../lib/dates';
import { useErrorText, useWorkspaceZone } from './parts';
import { CheckIcon, CopyIcon, ExternalIcon, LinkIcon } from './icons';
import { copyText, publicUrl, useInvoiceActions } from './use-invoice-actions';

export type LinkState = 'active' | 'revoked' | 'expired';

/** `revoked` wins over `expired`; an inactive link with neither stamp is treated as expired (the server's word is `active`). */
export function linkStateOf(link: NonNullable<InvoiceResponse['publicLink']>): LinkState {
  if (link.revokedAt) return 'revoked';
  return link.active ? 'active' : 'expired';
}

const EXPIRY_CHOICES = ['never', '7', '30', '90'] as const;

/**
 * The buyer's public link: its state (active, revoked, expired), the address to copy or open, how often and when the buyer
 * looked, and the two ways to change it: regenerate (the old link stops working at once; optionally with an expiry) and revoke
 * (the buyer sees "link unavailable"). The invoice detail shows it once the invoice has a link.
 */
export function PublicLinkCard({
  invoice,
  canChange,
}: {
  invoice: InvoiceResponse;
  canChange: boolean;
}) {
  const t = useTranslations('invoicing.linkCard');
  const locale = useLocale();
  const zone = useWorkspaceZone();
  const errorText = useErrorText();
  const actions = useInvoiceActions();
  const link = invoice.publicLink;
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [expiry, setExpiry] = useState<(typeof EXPIRY_CHOICES)[number]>('never');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!link) return null;
  const state = linkStateOf(link);
  const url = publicUrl(link.token);

  async function copy() {
    const ok = await copyText(url);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2500);
  }
  async function regenerate() {
    setError(null);
    setBusy(true);
    const r = await actions.regenerateLink(invoice, expiry === 'never' ? null : Number(expiry), {
      quiet: true,
    });
    setBusy(false);
    if (r.ok) setRegenerating(false);
    else setError(r.error);
  }
  async function revoke() {
    setError(null);
    setBusy(true);
    const r = await actions.revokeLink(invoice, { quiet: true });
    setBusy(false);
    if (r.ok) setRevoking(false);
    else setError(r.error);
  }

  return (
    <section
      aria-labelledby="inv-link"
      className="rounded-xl border border-border bg-background p-4 text-sm print:hidden"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="inv-link" className="text-sm font-semibold">
          {t('title')}
        </h2>
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
            state === 'active'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-border bg-muted text-muted-foreground',
          )}
        >
          {t(`state.${state}`)}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          readOnly
          dir="ltr"
          value={url}
          aria-label={t('address')}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0"
        />
        <Button
          variant="secondary"
          onClick={() => void copy()}
          className="shrink-0"
          disabled={state !== 'active'}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span className="sr-only sm:not-sr-only">{copied ? t('copied') : t('copy')}</span>
        </Button>
      </div>
      {state !== 'active' && (
        <p className="mt-2 text-xs text-muted-foreground">{t(`off.${state}`)}</p>
      )}
      <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
        {link.expiresAt && (
          <div className="flex justify-between gap-3">
            <dt>{t('expires')}</dt>
            <dd>{formatDateTime(link.expiresAt, locale, zone)}</dd>
          </div>
        )}
        {link.revokedAt && (
          <div className="flex justify-between gap-3">
            <dt>{t('revokedAt')}</dt>
            <dd>{formatDateTime(link.revokedAt, locale, zone)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt>{t('views')}</dt>
          <dd className="tabular-nums">{invoice.viewCount}</dd>
        </div>
        {invoice.firstViewedAt && (
          <div className="flex justify-between gap-3">
            <dt>{t('firstViewed')}</dt>
            <dd>{formatDateTime(invoice.firstViewedAt, locale, zone)}</dd>
          </div>
        )}
        {invoice.lastViewedAt && (
          <div className="flex justify-between gap-3">
            <dt>{t('lastViewed')}</dt>
            <dd>{formatDateTime(invoice.lastViewedAt, locale, zone)}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {state === 'active' && (
          <a
            href={link.path}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
          >
            <ExternalIcon /> {t('open')}
          </a>
        )}
        {canChange && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setRegenerating(true)}>
              <LinkIcon /> {t('regenerate')}
            </Button>
            {state === 'active' && (
              <Button
                size="sm"
                variant="secondary"
                className="border-danger text-danger hover:bg-danger/10"
                onClick={() => setRevoking(true)}
              >
                {t('revoke')}
              </Button>
            )}
          </>
        )}
      </div>

      {regenerating && (
        <Modal
          open
          onClose={() => {
            if (!busy) {
              setRegenerating(false);
              setError(null);
            }
          }}
          title={t('regenerateTitle')}
          closeLabel={t('close')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRegenerating(false)} disabled={busy}>
                {t('cancel')}
              </Button>
              <Button variant="brand" onClick={() => void regenerate()} disabled={busy}>
                {busy && <Spinner />}
                {t('regenerateConfirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Alert tone="warning">{t('regenerateWarning')}</Alert>
            <Field label={t('expiry')} htmlFor="link-expiry">
              <Select
                id="link-expiry"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value as typeof expiry)}
              >
                {EXPIRY_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c === 'never' ? t('expiryNever') : t('expiryDays', { count: Number(c) })}
                  </option>
                ))}
              </Select>
            </Field>
            {error !== null && <Alert tone="danger">{errorText(error)}</Alert>}
          </div>
        </Modal>
      )}
      <ConfirmDialog
        open={revoking}
        tone="danger"
        busy={busy}
        title={t('revokeTitle')}
        message={
          <span className="block space-y-3">
            <span className="block">{t('revokeMessage')}</span>
            {error !== null && <Alert tone="danger">{errorText(error)}</Alert>}
          </span>
        }
        confirmLabel={t('revokeConfirm')}
        cancelLabel={t('cancel')}
        onClose={() => {
          setRevoking(false);
          setError(null);
        }}
        onConfirm={() => void revoke()}
      />
    </section>
  );
}
