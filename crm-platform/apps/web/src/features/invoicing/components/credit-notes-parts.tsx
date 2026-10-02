'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import type { CreditNoteReason, CreditNoteSettlement, CreditNoteStatus } from '@crm/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  Modal,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '@crm/ui';
import { invalidateInvoicing } from '../api/hooks';
import { invoicingApi } from '../api/service';
import { useErrorText } from './parts';

/** The chip tones of the three credit note states. */
const STATUS_TONE: Record<CreditNoteStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  issued: 'border-success/30 bg-success/10 text-success',
  void: 'border-border bg-muted text-muted-foreground line-through decoration-muted-foreground/60',
};
const STATUS_DOT: Record<CreditNoteStatus, string> = {
  draft: 'bg-muted-foreground',
  issued: 'bg-success',
  void: 'bg-muted-foreground',
};

export function CreditStatusChip({
  status,
  className,
}: {
  status: CreditNoteStatus;
  className?: string;
}) {
  const t = useTranslations('invoicing.creditNotes.status');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        STATUS_TONE[status],
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', STATUS_DOT[status])} />
      {t(status)}
    </span>
  );
}

const REASON_TONE: Record<CreditNoteReason, string> = {
  return: 'border-primary/30 bg-primary/10 text-primary',
  price_adjustment: 'border-warning/30 bg-warning/10 text-warning',
  billing_error: 'border-danger/30 bg-danger/10 text-danger',
  cancellation: 'border-border bg-muted text-foreground',
  goodwill: 'border-success/30 bg-success/10 text-success',
  other: 'border-border bg-muted text-muted-foreground',
};

export function ReasonChip({
  reason,
  className,
}: {
  reason: CreditNoteReason;
  className?: string;
}) {
  const t = useTranslations('invoicing.creditNotes.reasons');
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        REASON_TONE[reason],
        className,
      )}
    >
      {t(reason)}
    </span>
  );
}

const SETTLEMENT_TONE: Record<CreditNoteSettlement, string> = {
  balance: 'border-border bg-muted text-foreground',
  refund: 'border-brand/30 bg-brand/10 text-brand dark:text-primary',
};

export function SettlementChip({
  settlement,
  className,
}: {
  settlement: CreditNoteSettlement;
  className?: string;
}) {
  const t = useTranslations('invoicing.creditNotes.settlements');
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        SETTLEMENT_TONE[settlement],
        className,
      )}
    >
      {t(settlement)}
    </span>
  );
}

export const creditNoteHref = (id: string) => `/credit-notes/${id}`;
export const creditNoteEditHref = (id: string) => `/credit-notes/${id}/edit`;
export const newCreditNoteHref = (invoiceId?: string) =>
  invoiceId ? `/credit-notes/new?invoice=${invoiceId}` : '/credit-notes/new';

/** What a row or the detail needs to name a credit note in a message. */
export interface CreditNoteTarget {
  id: string;
  number: string | null;
  rowVersion: number;
}

export type CreditDialogKind = 'issue' | 'void' | 'delete';

/**
 * The dialogs of the credit note actions (issue, void with a reason, delete a draft), owned in one place so the list and the
 * detail behave the same. Render `node` once; call `open(kind, note)` from a menu. Errors come back in our words by API code
 * (CN_NOTHING_TO_CREDIT, CN_EXCEEDS_INVOICE, CN_HAS_REFUND ...) and the dialog stays open on a failure.
 */
export function useCreditNoteDialogs(
  opts: { onDone?: (kind: CreditDialogKind, note: CreditNoteTarget) => void } = {},
): {
  open: (kind: CreditDialogKind, note: CreditNoteTarget) => void;
  node: ReactNode;
} {
  const t = useTranslations('invoicing.creditNotes.dialogs');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const [state, setState] = useState<{ kind: CreditDialogKind; note: CreditNoteTarget } | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setState(null);
    setReason('');
    setError(null);
  };

  async function run() {
    if (!state) return;
    const { kind, note } = state;
    const name = note.number ?? t('draftName');
    setBusy(true);
    setError(null);
    try {
      if (kind === 'issue') await invoicingApi.issueCreditNote(note.id, note.rowVersion);
      else if (kind === 'void') await invoicingApi.voidCreditNote(note.id, reason.trim());
      else await invoicingApi.removeCreditNote(note.id);
      await invalidateInvoicing(qc);
      toast(t(`done.${kind}`, { name }), 'success');
      setBusy(false);
      setState(null);
      setReason('');
      opts.onDone?.(kind, note);
    } catch (e) {
      setBusy(false);
      // Stale data: show what the server says now. The detail and the list refetch on their own after this.
      void invalidateInvoicing(qc);
      setError(errorText(e));
    }
  }

  let node: ReactNode = null;
  if (state) {
    const { kind, note } = state;
    const name = note.number ?? t('draftName');
    if (kind === 'void') {
      node = (
        <Modal
          open
          onClose={close}
          eyebrow={note.number ?? undefined}
          title={t('void.title')}
          closeLabel={t('close')}
          footer={
            <>
              <Button variant="secondary" onClick={close} disabled={busy}>
                {t('keep')}
              </Button>
              <Button
                variant="danger"
                onClick={() => void run()}
                disabled={busy || reason.trim().length === 0}
              >
                {busy && <Spinner />}
                {t('void.confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Alert tone="warning">{t('void.warning')}</Alert>
            <Field
              label={t('void.reason')}
              htmlFor="credit-void-reason"
              hint={t('void.reasonHint')}
            >
              <Textarea
                id="credit-void-reason"
                rows={3}
                maxLength={500}
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        </Modal>
      );
    } else {
      node = (
        <ConfirmDialog
          open
          tone={kind === 'delete' ? 'danger' : 'default'}
          busy={busy}
          title={t(`${kind}.title`)}
          message={
            <span className="block space-y-2">
              <span className="block">{t(`${kind}.message`, { name })}</span>
              {error && <span className="block text-danger">{error}</span>}
            </span>
          }
          confirmLabel={t(`${kind}.confirm`)}
          cancelLabel={t('keep')}
          onClose={close}
          onConfirm={() => void run()}
        />
      );
    }
  }

  return { open: (kind, note) => setState({ kind, note }), node };
}
