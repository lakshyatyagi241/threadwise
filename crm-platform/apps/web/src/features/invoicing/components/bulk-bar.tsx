'use client';

import type { InvoiceSummary } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, Button, Field, Modal, Spinner, Textarea } from '@crm/ui';
import type { BulkAction } from '../api/service';
import { actionFacts } from '../lib/invoice-facts';
import { allowedActions, type ActionContext, type InvoiceAction } from '../lib/status';
import { BanIcon, CheckIcon, SendIcon, TrashIcon } from './icons';

const ACTION_OF: Record<BulkAction, InvoiceAction> = {
  issue: 'issue',
  send: 'send',
  void: 'void',
  delete: 'delete',
};

/** The rows of a selection that accept `action`: the only ones a bulk call is made for (the rest would only answer 409). */
export function eligibleRows(
  rows: readonly InvoiceSummary[],
  action: BulkAction,
  can: ActionContext['can'],
): InvoiceSummary[] {
  return rows.filter((r) => allowedActions(actionFacts(r), { can }).has(ACTION_OF[action]));
}

/** How many selected invoices accept each action, so a button is offered only when at least one does. */
export function bulkEligibility(
  rows: readonly InvoiceSummary[],
  can: ActionContext['can'],
): Record<BulkAction, number> {
  return {
    issue: eligibleRows(rows, 'issue', can).length,
    send: eligibleRows(rows, 'send', can).length,
    void: eligibleRows(rows, 'void', can).length,
    delete: eligibleRows(rows, 'delete', can).length,
  };
}

export interface BulkBarProps {
  count: number;
  rows: readonly InvoiceSummary[];
  busy: boolean;
  can: ActionContext['can'];
  onAction: (a: BulkAction) => void;
  onClear: () => void;
}

/** Appears over the table while rows are ticked: issue drafts, record "sent" with the link, void with a reason, delete drafts. */
export function BulkBar(p: BulkBarProps) {
  const t = useTranslations('invoicing.bulk');
  const e = bulkEligibility(p.rows, p.can);
  return (
    <div
      role="region"
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-2 rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-sm"
    >
      <span className="font-medium" aria-live="polite">
        {t('selected', { count: p.count })}
      </span>
      {p.busy && <Spinner label={t('working')} />}
      {p.can.issue && (
        <Button
          size="sm"
          variant="secondary"
          disabled={p.busy || e.issue === 0}
          onClick={() => p.onAction('issue')}
        >
          <CheckIcon /> {t('issue')}
        </Button>
      )}
      {p.can.update && (
        <Button
          size="sm"
          variant="secondary"
          disabled={p.busy || e.send === 0}
          onClick={() => p.onAction('send')}
        >
          <SendIcon /> {t('sendLink')}
        </Button>
      )}
      {p.can.void && (
        <Button
          size="sm"
          variant="secondary"
          className="border-danger text-danger hover:bg-danger/10"
          disabled={p.busy || e.void === 0}
          onClick={() => p.onAction('void')}
        >
          <BanIcon /> {t('void')}
        </Button>
      )}
      {p.can.remove && (
        <Button
          size="sm"
          variant="secondary"
          className="border-danger text-danger hover:bg-danger/10"
          disabled={p.busy || e.delete === 0}
          onClick={() => p.onAction('delete')}
        >
          <TrashIcon /> {t('delete')}
        </Button>
      )}
      <button
        type="button"
        onClick={p.onClear}
        className="ms-auto text-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('clear')}
      </button>
    </div>
  );
}

/** Void several invoices at once: one reason (required) for all, and how many of the selection are skipped. */
export function BulkVoidDialog({
  eligible,
  skipped,
  busy,
  onConfirm,
  onClose,
}: {
  eligible: number;
  skipped: number;
  busy: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('invoicing.bulk.voidDialog');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const submit = () => {
    if (!reason.trim()) {
      setProblem(t('reasonRequired'));
      return;
    }
    onConfirm(reason.trim());
  };
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t('title')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('keep')}
          </Button>
          <Button variant="danger" onClick={submit} disabled={busy}>
            {busy && <Spinner />}
            {t('confirm', { count: eligible })}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Alert tone="warning">{t('warning', { count: eligible })}</Alert>
        {skipped > 0 && <Alert tone="info">{t('skipped', { count: skipped })}</Alert>}
        <Field label={t('reason')} htmlFor="bulk-void-reason" error={problem}>
          <Textarea
            id="bulk-void-reason"
            rows={3}
            autoFocus
            maxLength={500}
            value={reason}
            invalid={!!problem}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
