'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button, Field, Input, Modal, Spinner, Textarea, cn, useToast } from '@crm/ui';
import type { SalesDoc, SendInput, SendResult } from '../api/schemas';
import { salesDocsApi } from '../api/service';
import { isUnavailable } from '../lib/errors';
import { phoneDigits } from '../lib/format';
import { formatMoney } from '../lib/money';
import { CheckIcon, CopyIcon, LinkIcon, MailIcon, WhatsAppIcon } from './icons';
import { useErrorText, useSalesDocsCan } from './parts';

type Channel = 'link' | 'email' | 'whatsapp';

/** The three-line text Reference sends over WhatsApp, localised: what it is, the total, the link. */
export function whatsappText(
  doc: Pick<SalesDoc, 'number' | 'title' | 'totalMinor' | 'currency'>,
  link: string,
  labels: { kind: string; total: string; view: string },
  locale: string,
): string {
  const head = `${labels.kind} ${doc.number}${doc.title ? ` - ${doc.title}` : ''}`;
  return [
    head,
    `${labels.total}: ${formatMoney(doc.totalMinor, doc.currency, locale)}`,
    `${labels.view}: ${link}`,
  ].join('\n');
}

/**
 * Sends a document to the buyer: copy the public link, email it, or send it on WhatsApp. Sending from a draft marks it sent
 * (the server does that). "I shared it" records a link that was passed on by hand.
 */
export function SendDialog({
  doc,
  busy,
  onSend,
  onChanged,
  onClose,
}: {
  doc: SalesDoc | null;
  busy: boolean;
  onSend: (doc: SalesDoc, input: SendInput) => Promise<SendResult | null>;
  /** The link was regenerated or revoked: the document's link state changed. */
  onChanged: (doc: SalesDoc) => void;
  onClose: () => void;
}) {
  const t = useTranslations('sales-docs.send');
  return (
    <Modal
      open={doc !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      size="md"
      title={t('title', { number: doc?.number ?? '' })}
      eyebrow={t('eyebrow')}
      closeLabel={t('close')}
      footer={
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('done')}
        </Button>
      }
    >
      {/* keyed by document: every document opens a fresh form, defaults filled in from it */}
      {doc && <SendBody key={doc.id} doc={doc} busy={busy} onSend={onSend} onChanged={onChanged} />}
    </Modal>
  );
}

function SendBody({
  doc,
  busy,
  onSend,
  onChanged,
}: {
  doc: SalesDoc;
  busy: boolean;
  onSend: (doc: SalesDoc, input: SendInput) => Promise<SendResult | null>;
  onChanged: (doc: SalesDoc) => void;
}) {
  const t = useTranslations('sales-docs.send');
  const tk = useTranslations('sales-docs.kind');
  const locale = useLocale();
  const can = useSalesDocsCan();
  const { toast } = useToast();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const base = useId();
  const [channel, setChannel] = useState<Channel>('link');
  const [to, setTo] = useState(doc.buyer.email);
  const [message, setMessage] = useState(() => t('messageDefault', { name: doc.buyer.name || '' }));
  const [copied, setCopied] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);

  const linkKey = ['sales-docs', 'link', doc.id] as const;
  const link = useQuery({
    queryKey: linkKey,
    queryFn: ({ signal }) => salesDocsApi.link(doc.id, signal),
    retry: false,
  });
  const url = link.data?.url ?? '';
  const linkMutation = useMutation({
    mutationFn: (kind: 'regenerate' | 'revoke') =>
      kind === 'regenerate' ? salesDocsApi.regenerateLink(doc.id) : salesDocsApi.revokeLink(doc.id),
    onSuccess: async (next, kind) => {
      qc.setQueryData(linkKey, next);
      setConfirmNew(false);
      toast(t(kind === 'regenerate' ? 'regenerated' : 'revoked'), 'success');
      onChanged(await salesDocsApi.get(doc.id));
    },
    onError: (e) => toast(errorText(e), 'danger'),
  });

  /** Any send changes whether the link is reachable (a draft's link only opens once it is sent): read it again. */
  const send = async (input: SendInput) => {
    const r = await onSend(doc, input);
    if (r) void qc.invalidateQueries({ queryKey: linkKey });
    return r;
  };

  const wa = whatsappText(
    doc,
    url,
    { kind: tk(`${doc.kind}.singular`), total: t('waTotal'), view: t('waView') },
    locale,
  );
  const digits = phoneDigits(doc.buyer.phone);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast(t('copiedToast'), 'success');
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast(t('copyFailed'), 'danger');
    }
  }

  const tabs: Array<{ id: Channel; label: string; icon: typeof LinkIcon }> = [
    { id: 'link', label: t('tabs.link'), icon: LinkIcon },
    { id: 'email', label: t('tabs.email'), icon: MailIcon },
    { id: 'whatsapp', label: t('tabs.whatsapp'), icon: WhatsAppIcon },
  ];

  const isDraft = doc.status === 'draft';
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to.trim());
  const state = link.data;

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={t('channels')}
        className="flex gap-1 rounded-md border border-border p-1"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={`${base}-${id}`}
            type="button"
            role="tab"
            aria-selected={channel === id}
            aria-controls={`${base}-panel`}
            onClick={() => setChannel(id)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary',
              channel === id
                ? 'bg-brand text-brand-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon /> {label}
          </button>
        ))}
      </div>

      <div
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-${channel}`}
        className="space-y-3"
      >
        {channel === 'link' && (
          <>
            <Field label={t('linkLabel')} htmlFor={`${base}-link`} hint={t('linkHint')}>
              <div className="flex gap-2">
                <Input
                  id={`${base}-link`}
                  readOnly
                  dir="ltr"
                  value={link.isPending ? '' : url}
                  placeholder={link.isPending ? t('linkLoading') : undefined}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button variant="secondary" onClick={() => void copy()} disabled={!url}>
                  {copied ? <CheckIcon /> : <CopyIcon />} {copied ? t('copied') : t('copy')}
                </Button>
              </div>
            </Field>
            {link.isError && (
              <p role="alert" className="text-sm text-danger">
                {isUnavailable(link.error) ? t('linkUnavailable') : errorText(link.error)}
              </p>
            )}
            {state && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {isDraft
                  ? t('stateDraft')
                  : state.revokedAt
                    ? t('stateRevoked')
                    : state.active
                      ? t('stateActive', { views: doc.link.viewCount })
                      : t('stateInactive')}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {isDraft && can.send && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void send({ channel: 'link' })}
                >
                  {busy && <Spinner />} {t('markSent')}
                </Button>
              )}
              {!isDraft && can.send && !confirmNew && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={linkMutation.isPending}
                    onClick={() => setConfirmNew(true)}
                  >
                    {t('regenerate')}
                  </Button>
                  {state?.active && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      disabled={linkMutation.isPending}
                      onClick={() => linkMutation.mutate('revoke')}
                    >
                      {t('revoke')}
                    </Button>
                  )}
                </>
              )}
            </div>
            {confirmNew && (
              <div
                role="alert"
                className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
              >
                <p>{t('regenerateWarning')}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirmNew(false)}
                    disabled={linkMutation.isPending}
                  >
                    {t('keepLink')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={linkMutation.isPending}
                    onClick={() => linkMutation.mutate('regenerate')}
                  >
                    {linkMutation.isPending && <Spinner />} {t('regenerateConfirm')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {channel === 'email' && (
          <>
            <Field
              label={t('to')}
              htmlFor={`${base}-to`}
              error={to.trim() && !emailOk ? t('emailInvalid') : undefined}
              hint={!to.trim() ? t('noEmail') : undefined}
            >
              <Input
                id={`${base}-to`}
                type="email"
                dir="ltr"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                invalid={!!to.trim() && !emailOk}
              />
            </Field>
            <Field label={t('message')} htmlFor={`${base}-message`} hint={t('messageHint')}>
              <Textarea
                id={`${base}-message`}
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={2000}
              />
            </Field>
            <Button
              variant="brand"
              disabled={busy || !emailOk}
              onClick={() =>
                void send({ channel: 'email', to: to.trim(), message: message.trim() || undefined })
              }
            >
              {busy ? <Spinner /> : <MailIcon />} {t('sendEmail')}
            </Button>
          </>
        )}

        {channel === 'whatsapp' && (
          <>
            {digits ? (
              <p className="text-sm">
                {t('waTo')}{' '}
                <span dir="ltr" className="font-medium">
                  {doc.buyer.phone}
                </span>
              </p>
            ) : (
              <p
                role="alert"
                className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
              >
                {t('noPhone')}
              </p>
            )}
            <Field label={t('waPreview')} htmlFor={`${base}-wa`}>
              <Textarea
                id={`${base}-wa`}
                readOnly
                rows={4}
                value={wa}
                dir="auto"
                className="bg-muted/40"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="brand"
                disabled={busy || !digits}
                onClick={() => void send({ channel: 'whatsapp' })}
              >
                {busy ? <Spinner /> : <WhatsAppIcon />} {t('sendWhatsapp')}
              </Button>
              <a
                href={`https://wa.me/${digits}?text=${encodeURIComponent(wa)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!digits || !url}
                className={cn(
                  'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
                  (!digits || !url) && 'pointer-events-none opacity-50',
                )}
              >
                <WhatsAppIcon /> {t('openWhatsapp')}
              </a>
            </div>
            <p className="text-xs text-muted-foreground">{t('waHint')}</p>
          </>
        )}
      </div>
    </div>
  );
}
