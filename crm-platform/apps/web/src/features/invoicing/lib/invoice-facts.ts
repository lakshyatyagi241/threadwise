import type { InvoiceSummary } from '@crm/contracts';
import type { ActionFacts } from './status';
import { invoiceMinor } from './wire';

/**
 * What `allowedActions` needs from an invoice row. A list row carries no public link (only the detail does), so for a row an
 * invoice that is issued and not void is assumed to have one (it is minted at issue) and the copy action checks it when it runs.
 */
export function actionFacts(inv: InvoiceSummary, hasPublicLink?: boolean): ActionFacts {
  const m = invoiceMinor(inv);
  const live = inv.status !== 'draft' && inv.status !== 'void';
  return {
    status: inv.status,
    paidMinor: m.paid,
    balanceMinor: m.balance,
    creditedMinor: m.credited,
    hasPublicLink: hasPublicLink ?? live,
  };
}

/**
 * The amount a list row shows as its balance, in minor units: a draft owes nothing yet, so it shows its total (the server sends
 * a balance of 0 for it); a void invoice shows none.
 */
export function rowBalanceMinor(inv: InvoiceSummary): number | null {
  const m = invoiceMinor(inv);
  if (inv.status === 'void') return null;
  return inv.status === 'draft' ? m.total : m.balance;
}
