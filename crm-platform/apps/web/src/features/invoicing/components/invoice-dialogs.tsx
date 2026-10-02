'use client';

import { INVOICE_SEND_CHANNELS, type InvoiceResponse, type InvoiceSummary } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Field, Input, Modal, Select, Spinner, Textarea, useToast } from '@crm/ui';
import { invalidateInvoicing, useInvoice } from '../api/hooks';
import { invoicingApi } from '../api/service';
import { errorCode, errorKind, fieldErrors } from '../lib/errors';
import { invoiceMinor } from '../lib/wire';
import { ContactPicker } from './contact-picker';
import { CheckIcon, CopyIcon, LinkIcon } from './icons';
import { ErrorLine, useErrorText } from './parts';
import { copyText, linkIsLive, publicUrl, useInvoiceActions } from './use-invoice-actions';
import { useMembers } from './use-members';

export const VOID_REASON_MAX = 500;
export const SEND_MESSAGE_MAX = 1000;

/**
 * Void with a reason (required). The server refuses an invoice that still carries a net payment (INV_HAS_PAYMENTS: refund it
 * first) or has credit notes against it (INV_HAS_CREDITS); the sentence it earns says what to do and stays in the dialog.
 */
export function VoidDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: Pick<InvoiceSummary, 'id' | 'number' | 'rowVersion' | 'amountsMinor'>;
  onClose: () => void;
  onDone?: (inv: InvoiceResponse) => void;
}) {
  const t = useTranslations('invoicing.voidDialog');
  const errorText = useErrorText();
  const actions = useInvoiceActions();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const m = invoiceMinor(invoice);

  async function confirm() {
    const text = reason.trim();
    if (!text) {
      setProblem(t('reasonRequired'));
      return;
    }
    setProblem(undefined);
    setError(null);
    setBusy(true);
    const r = await actions.voidInvoice(invoice, text, { quiet: true });
    setBusy(false);
    if (r.ok) {
      onDone?.(r.value);
      onClose();
    } else setError(r.error);
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={invoice.number ?? undefined}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('keep')}
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy}>
            {busy && <Spinner />}
            {t('void')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <Alert tone="warning">{t('warning')}</Alert>
        {m.paid > 0 && <Alert tone="info">{t('refundFirst')}</Alert>}
        {m.credited > 0 && <Alert tone="info">{t('creditsFirst')}</Alert>}
        <Field label={t('reason')} htmlFor="void-reason" hint={t('reasonHint')} error={problem}>
          <Textarea
            id="void-reason"
            rows={3}
            autoFocus
            maxLength={VOID_REASON_MAX}
            value={reason}
            invalid={!!problem}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error !== null && <Alert tone="danger">{errorText(error)}</Alert>}
      </form>
    </Modal>
  );
}

/**
 * Issue and send. A draft first asks to be issued (the number is allocated and the invoice is frozen). An issued invoice then
 * offers the three channels: the public link (staff share it themselves; this only records it), email and WhatsApp (both need
 * the buyer's address or number: INV_NO_RECIPIENT otherwise, which the dialog explains and points to "Edit details").
 */
export function SendDialog({
  invoice,
  onClose,
  onChanged,
}: {
  invoice: Pick<InvoiceSummary, 'id' | 'number' | 'status' | 'rowVersion' | 'sentAt' | 'buyerEmail'>;
  onClose: () => void;
  onChanged?: (inv: InvoiceResponse) => void;
}) {
  const t = useTranslations('invoicing.sendDialog');
  const errorText = useErrorText();
  const actions = useInvoiceActions();
  const { toast } = useToast();
  const [issuedNow, setIssuedNow] = useState<InvoiceResponse | null>(null);
  const [channel, setChannel] = useState<(typeof INVOICE_SEND_CHANNELS)[number]>('link');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const wasDraft = invoice.status === 'draft';
  const detail = useInvoice(wasDraft ? null : invoice.id);
  const current = issuedNow ?? detail.data ?? null;
  const draft = wasDraft && !issuedNow;
  const link = linkIsLive(current?.publicLink) ? publicUrl(current.publicLink.token) : '';
  const number = current?.number ?? invoice.number;
  const recipientMissing =
    current !== null && ((channel === 'email' && !current.buyer.email) || (channel === 'whatsapp' && !current.buyer.phone));

  async function issue() {
    setError(null);
    setBusy(true);
    const r = await actions.issue(invoice, { quiet: true });
    setBusy(false);
    if (r.ok) {
      setIssuedNow(r.value);
      onChanged?.(r.value);
    } else setError(r.error);
  }

  async function send() {
    setError(null);
    setBusy(true);
    const r = await actions.send(
      invoice,
      { channel, message: channel === 'link' ? undefined : message.trim() || undefined },
      { quiet: true },
    );
    setBusy(false);
    if (r.ok) {
      onChanged?.(r.value);
      onClose();
    } else setError(r.error);
  }

  async function copy() {
    const ok = await copyText(link);
    setCopied(ok);
    if (!ok) toast(t('copyFailed'), 'danger');
    if (ok) window.setTimeout(() => setCopied(false), 2500);
  }

  return (
    <Modal
      open
      size="md"
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={number ?? undefined}
      title={draft ? t('issueTitle') : t('title')}
      closeLabel={t('close')}
      footer={
        draft ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button variant="brand" onClick={() => void issue()} disabled={busy}>
              {busy && <Spinner />}
              {t('issue')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('done')}
            </Button>
            <Button variant="brand" onClick={() => void send()} disabled={busy || !current}>
              {busy && <Spinner />}
              {t(`action.${channel}`)}
            </Button>
          </>
        )
      }
    >
      {draft ? (
        <div className="space-y-3 text-sm">
          <p>{t('issueIntro')}</p>
          <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
            <li>{t('issueNumber')}</li>
            <li>{t('issueFrozen')}</li>
            <li>{t('issueLink')}</li>
          </ul>
          {error !== null && <Alert tone="danger">{errorText(error)}</Alert>}
        </div>
      ) : detail.isPending && !issuedNow ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : detail.isError && !issuedNow ? (
        <ErrorLine error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <div className="space-y-4">
          <Field label={t('channel')} htmlFor="send-channel">
            <Select id="send-channel" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              {INVOICE_SEND_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`channels.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          {channel === 'link' ? (
            <>
              <Field label={t('link')} htmlFor="send-link" hint={link ? t('linkHint') : undefined}>
                {link ? (
                  <div className="flex gap-2">
                    <Input id="send-link" readOnly dir="ltr" value={link} onFocus={(e) => e.currentTarget.select()} />
                    <Button variant="secondary" onClick={() => void copy()} className="shrink-0">
                      {copied ? <CheckIcon /> : <CopyIcon />}
                      {copied ? t('copied') : t('copy')}
                    </Button>
                  </div>
                ) : (
                  <Alert tone="warning">{t('linkOff')}</Alert>
                )}
              </Field>
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-2"
                >
                  <LinkIcon /> {t('open')}
                </a>
              )}
              <p className="text-xs text-muted-foreground">{t('linkRecords')}</p>
            </>
          ) : (
            <>
              <p className="rounded-md bg-muted px-3 py-2 text-sm" dir="auto">
                {channel === 'email'
                  ? (current?.buyer.email ?? invoice.buyerEmail ?? t('noEmail'))
                  : (current?.buyer.phone ?? t('noPhone'))}
              </p>
              {recipientMissing && <Alert tone="warning">{t(channel === 'email' ? 'noEmailHelp' : 'noPhoneHelp')}</Alert>}
              <Field label={t('message')} htmlFor="send-message" hint={t('messageHint')}>
                <Textarea
                  id="send-message"
                  rows={3}
                  maxLength={SEND_MESSAGE_MAX}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </Field>
              <p className="text-xs text-muted-foreground">{t('deliveryNote')}</p>
            </>
          )}
          {error !== null && (
            <Alert tone="danger">
              {errorCode(error) === 'INV_NO_RECIPIENT' ? t(channel === 'whatsapp' ? 'noPhoneHelp' : 'noEmailHelp') : errorText(error)}
            </Alert>
          )}
          {current?.sentAt && <p className="text-xs text-muted-foreground">{t('alreadySent')}</p>}
        </div>
      )}
    </Modal>
  );
}

/**
 * "Edit details" for an ISSUED invoice: the lines, amounts and buyer name are frozen, so only what the API still lets move after
 * issue is offered (buyer email and phone, contact, owner, due date, reference, notes, terms). It sends the `rowVersion` that
 * was read; when someone changed the invoice meanwhile (409) it asks the person to reload and never retries by itself.
 */
export function EditDetailsDialog({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: InvoiceResponse;
  onClose: () => void;
  onSaved?: (inv: InvoiceResponse) => void;
}) {
  const t = useTranslations('invoicing.editDialog');
  const errorText = useErrorText();
  const qc = useQueryClient();
  const { toast } = useToast();
  const members = useMembers();
  const [email, setEmail] = useState(invoice.buyer.email ?? '');
  const [phone, setPhone] = useState(invoice.buyer.phone ?? '');
  const [contact, setContact] = useState<{ id: string; label: string } | null>(
    invoice.contact ? { id: invoice.contact.id, label: invoice.contact.name ?? '' } : null,
  );
  const [owner, setOwner] = useState(invoice.owner?.id ?? '');
  const [dueDate, setDueDate] = useState(invoice.dueDate ?? '');
  const [reference, setReference] = useState(invoice.reference ?? '');
  const [notes, setNotes] = useState(invoice.notes ?? '');
  const [terms, setTerms] = useState(invoice.terms ?? '');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const blank = (v: string) => v.trim() || null;

  async function save() {
    setErrors({});
    setBusy(true);
    try {
      const saved = await invoicingApi.update(invoice.id, invoice.rowVersion, {
        buyerEmail: blank(email),
        buyerPhone: blank(phone),
        contactId: contact?.id ?? null,
        ...(owner ? { ownerId: owner } : {}),
        dueDate: dueDate || null,
        reference: blank(reference),
        notes: blank(notes),
        terms: blank(terms),
      });
      await invalidateInvoicing(qc);
      toast(t('saved'));
      onSaved?.(saved);
      onClose();
    } catch (e) {
      if (errorKind(e) === 'conflict') {
        setConflict(true);
      } else {
        const server = fieldErrors(e);
        const form =
          Object.keys(server).length === 0 || errorCode(e) === 'INV_OWNER_INVALID' ? errorText(e) : undefined;
        setErrors({
          buyerEmail: server.buyerEmail,
          buyerPhone: server.buyerPhone,
          dueDate: server.dueDate,
          reference: server.reference,
          notes: server.notes,
          terms: server.terms,
          form,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    await invalidateInvoicing(qc);
    onClose();
  }

  return (
    <Modal
      open
      size="lg"
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={invoice.number ?? undefined}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        conflict ? (
          <Button variant="brand" onClick={() => void reload()}>
            {t('reload')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button variant="brand" onClick={() => void save()} disabled={busy}>
              {busy && <Spinner />}
              {t('save')}
            </Button>
          </>
        )
      }
    >
      {conflict ? (
        <Alert tone="warning">{t('conflict')}</Alert>
      ) : (
        <form
          className="grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="text-sm text-muted-foreground sm:col-span-2">{t('intro')}</p>
          {errors.form && (
            <Alert tone="danger" className="sm:col-span-2">
              {errors.form}
            </Alert>
          )}
          <Field label={t('email')} htmlFor="edit-email" error={errors.buyerEmail}>
            <Input id="edit-email" type="email" dir="ltr" value={email} invalid={!!errors.buyerEmail} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('phone')} htmlFor="edit-phone" hint={t('phoneHint')} error={errors.buyerPhone}>
            <Input id="edit-phone" type="tel" dir="ltr" value={phone} invalid={!!errors.buyerPhone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label={t('contact')} htmlFor="edit-contact">
            <ContactPicker id="edit-contact" value={contact} onChange={(c) => setContact(c ? { id: c.id, label: c.label } : null)} />
          </Field>
          <Field label={t('owner')} htmlFor="edit-owner">
            <Select id="edit-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
              {!owner && <option value="">-</option>}
              {(members.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
              {owner && !(members.data ?? []).some((m) => m.id === owner) && invoice.owner && (
                <option value={owner}>{invoice.owner.name}</option>
              )}
            </Select>
          </Field>
          <Field label={t('dueDate')} htmlFor="edit-due" hint={t('dueHint')} error={errors.dueDate}>
            <Input id="edit-due" type="date" value={dueDate} min={invoice.issueDate ?? undefined} invalid={!!errors.dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label={t('reference')} htmlFor="edit-ref" error={errors.reference}>
            <Input id="edit-ref" maxLength={191} value={reference} invalid={!!errors.reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label={t('notes')} htmlFor="edit-notes" className="sm:col-span-2" error={errors.notes}>
            <Textarea id="edit-notes" rows={3} maxLength={5000} value={notes} invalid={!!errors.notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label={t('terms')} htmlFor="edit-terms" className="sm:col-span-2" error={errors.terms}>
            <Textarea id="edit-terms" rows={3} maxLength={10000} value={terms} invalid={!!errors.terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>
        </form>
      )}
    </Modal>
  );
}
