'use client';

import type { InvoiceSummary } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Alert, ConfirmDialog } from '@crm/ui';
import { SendDialog, VoidDialog } from './invoice-dialogs';
import { MarkPaidDialog, RecordPaymentDialog } from './payment-dialogs';
import { useErrorText } from './parts';
import { useInvoiceActions } from './use-invoice-actions';

export type DialogKind = 'send' | 'pay' | 'markPaid' | 'void' | 'delete';
type Target = InvoiceSummary;

/**
 * The dialogs an invoice action opens (issue and send, record payment, mark paid, void, delete), owned in one place so the
 * list and the detail page behave the same. Render `node` once; call `open(kind, invoice)` from a menu.
 */
export function useInvoiceDialogs(opts: { onDeleted?: (inv: Target) => void } = {}): {
  open: (kind: DialogKind, inv: Target) => void;
  node: ReactNode;
} {
  const t = useTranslations('invoicing.deleteDialog');
  const errorText = useErrorText();
  const actions = useInvoiceActions();
  const [state, setState] = useState<{ kind: DialogKind; inv: Target } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setState(null);
    setError(null);
  };

  async function confirmDelete() {
    if (!state) return;
    setError(null);
    setBusy(true);
    const r = await actions.remove(state.inv, { quiet: true });
    setBusy(false);
    if (r.ok) {
      opts.onDeleted?.(state.inv);
      close();
    } else setError(r.error);
  }

  let node: ReactNode = null;
  if (state) {
    const { kind, inv } = state;
    if (kind === 'send') node = <SendDialog invoice={inv} onClose={close} />;
    else if (kind === 'pay') node = <RecordPaymentDialog invoice={inv} onClose={close} />;
    else if (kind === 'markPaid') node = <MarkPaidDialog invoice={inv} onClose={close} />;
    else if (kind === 'void') node = <VoidDialog invoice={inv} onClose={close} />;
    else {
      node = (
        <ConfirmDialog
          open
          tone="danger"
          busy={busy}
          title={t('title')}
          message={
            <span className="block space-y-3">
              <span className="block">
                {t('message', { name: inv.number ?? inv.buyerName ?? inv.contact?.name ?? '' })}
              </span>
              {error !== null && <Alert tone="danger">{errorText(error)}</Alert>}
            </span>
          }
          confirmLabel={t('delete')}
          cancelLabel={t('keep')}
          onClose={close}
          onConfirm={() => void confirmDelete()}
        />
      );
    }
  }
  return { open: (kind, inv) => setState({ kind, inv }), node };
}
