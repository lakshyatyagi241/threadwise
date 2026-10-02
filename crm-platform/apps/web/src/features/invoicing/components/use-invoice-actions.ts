'use client';

import type { InvoiceLinkState, InvoiceSummary, MANUAL_PAYMENT_METHODS, SendInvoiceInput } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useToast } from '@crm/ui';
import { KEYS, invalidateInvoicing } from '../api/hooks';
import { invoicePdfPath, invoicingApi } from '../api/service';
import { minorToInput } from '../lib/money';
import { invoiceMinor } from '../lib/wire';
import { useErrorText, useToday } from './parts';

/** The public page of an invoice, as a full address (to copy or open). */
export const publicPath = (token: string): string => `/i/${token}`;
export const publicUrl = (token: string): string =>
  typeof window === 'undefined' ? publicPath(token) : `${window.location.origin}${publicPath(token)}`;

/** True when the buyer's link can be opened right now (not revoked, not expired). */
export const linkIsLive = (link: InvoiceLinkState | null | undefined): link is InvoiceLinkState => !!link && link.active;

/** Copies text; resolves false when the browser refuses (insecure context, no permission). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type ManualMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

/** What an action did: the changed invoice (or other value), or the error that was raised (already shown unless `quiet`). */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
interface RunOptions {
  /** Do not toast a failure: the caller shows it inside its own dialog. */
  quiet?: boolean;
}

/**
 * The single-invoice actions, each with its toast and a refresh of every list. A dialog asks for `quiet` and prints the failure
 * itself, so the person reads, say, "refund the payments first" next to the form, not in a toast that fades.
 */
export function useInvoiceActions() {
  const t = useTranslations('invoicing.actions');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const today = useToday();

  async function run<T>(fn: () => Promise<T>, done: (r: T) => string | null, opts: RunOptions = {}): Promise<Outcome<T>> {
    try {
      const value = await fn();
      await invalidateInvoicing(qc);
      const message = done(value);
      if (message) toast(message);
      return { ok: true, value };
    } catch (error) {
      if (!opts.quiet) toast(`${t('failed')} ${errorText(error)}`, 'danger');
      return { ok: false, error };
    }
  }

  return {
    issue: (inv: Pick<InvoiceSummary, 'id' | 'rowVersion'>, opts?: RunOptions) =>
      run(() => invoicingApi.issue(inv.id, { rowVersion: inv.rowVersion }), (r) => t('issued', { number: r.number ?? '' }), opts),
    send: (inv: Pick<InvoiceSummary, 'id'>, body: Partial<SendInvoiceInput>, opts?: RunOptions) =>
      run(
        () => invoicingApi.send(inv.id, body),
        () => t(`sentVia.${body.channel ?? 'link'}`),
        opts,
      ),
    voidInvoice: (inv: Pick<InvoiceSummary, 'id' | 'rowVersion'>, reason: string, opts?: RunOptions) =>
      run(() => invoicingApi.void(inv.id, reason, inv.rowVersion), (r) => t('voided', { number: r.number ?? '' }), opts),
    duplicate: (inv: Pick<InvoiceSummary, 'id'>) => run(() => invoicingApi.duplicate(inv.id), () => t('duplicated')),
    remove: (inv: Pick<InvoiceSummary, 'id'>, opts?: RunOptions) =>
      run(() => invoicingApi.remove(inv.id), () => t('deleted'), opts),
    /** Records the whole balance as received today: "Mark as paid". */
    markPaid: (inv: Pick<InvoiceSummary, 'id' | 'currency' | 'amountsMinor'>, method: ManualMethod, opts?: RunOptions) =>
      run(
        () =>
          invoicingApi.recordPayment(inv.id, {
            amount: minorToInput(invoiceMinor(inv).balance, inv.currency),
            method,
            paidAt: today,
          }),
        () => t('markedPaid'),
        opts,
      ),
    regenerateLink: (inv: Pick<InvoiceSummary, 'id'>, expiresInDays: number | null, opts?: RunOptions) =>
      run(
        () => invoicingApi.regenerateLink(inv.id, expiresInDays ? { expiresInDays } : {}),
        () => t('linkRegenerated'),
        opts,
      ),
    revokeLink: (inv: Pick<InvoiceSummary, 'id'>, opts?: RunOptions) =>
      run(() => invoicingApi.revokeLink(inv.id), () => t('linkRevoked'), opts),
    /**
     * A list row has no link (only the detail does): read the invoice now and copy the live link, or say it is off. The detail
     * passes the link it already has.
     */
    copyLink: async (inv: Pick<InvoiceSummary, 'id'>, known?: InvoiceLinkState | null): Promise<boolean> => {
      try {
        const link =
          known !== undefined
            ? known
            : (await qc.fetchQuery({ queryKey: KEYS.invoice(inv.id), queryFn: ({ signal }) => invoicingApi.get(inv.id, signal), staleTime: 0 }))
                .publicLink;
        if (!linkIsLive(link)) {
          toast(t('linkUnavailable'), 'danger');
          return false;
        }
        const ok = await copyText(publicUrl(link.token));
        toast(ok ? t('linkCopied') : t('linkCopyFailed'), ok ? 'info' : 'danger');
        return ok;
      } catch (error) {
        toast(`${t('failed')} ${errorText(error)}`, 'danger');
        return false;
      }
    },
    /** The PDF is a same-origin download (the session cookie rides along on the proxy). */
    downloadPdf: (inv: Pick<InvoiceSummary, 'id'>) => {
      window.open(invoicePdfPath(inv.id), '_blank', 'noopener');
    },
  };
}
