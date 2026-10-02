import {
  minorToMajor,
  type SalesDocDiscount,
  type SalesDocKind,
  type SalesDocLine,
  type SalesDocTotals,
} from '@crm/contracts';

/**
 * The printable view of a document (TW-PROP-030 "PDF"). The repo has no PDF library, so the endpoint serves a self-contained,
 * print-optimised HTML page (A4 `@page`, no scripts, no external requests): "Save as PDF" in any browser produces the file. A server
 * side PDF (a worker job writing to media storage) is a listed follow-up.
 *
 * Every dynamic value goes through `esc`; the page carries no markup of the buyer's or the seller's.
 */

export interface PrintView {
  kind: SalesDocKind;
  number: string;
  title: string | null;
  statusLabel: string;
  sellerName: string;
  buyerName: string | null;
  buyerCompany: string | null;
  currency: string;
  lines: SalesDocLine[];
  totals: SalesDocTotals;
  discount: SalesDocDiscount | null;
  taxRate: string;
  notes: string | null;
  terms: string | null;
  validUntil: string | null;
  signedBy: string | null;
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => ENTITIES[c]!);

/** `1234.5` -> `1,234.5`: grouping on the integer part of a decimal STRING (no float). */
export function groupMajor(major: string): string {
  const [whole = '0', frac] = major.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

const money = (currency: string, major: string) =>
  `${esc(currency)}&nbsp;${esc(groupMajor(major))}`;

const lineDiscountText = (l: SalesDocLine): string =>
  l.discount
    ? l.discount.kind === 'percent'
      ? `${l.discount.value}%`
      : groupMajor(l.discount.value)
    : '';

export function renderSalesDocHtml(v: PrintView): string {
  const kindLabel = v.kind === 'estimate' ? 'Estimate' : 'Proposal';
  const hasLineDiscount = v.lines.some((l) => l.discount);
  const hasLineTax = v.lines.some((l) => l.taxRate !== null && l.taxRate !== v.taxRate);
  const rows = v.lines
    .map(
      (l) => `<tr>
        <td>${esc(l.description)}</td>
        <td class="n">${esc(l.qty)}</td>
        <td class="n">${esc(groupMajor(l.unitPrice))}</td>
        ${hasLineDiscount ? `<td class="n">${esc(lineDiscountText(l))}</td>` : ''}
        ${hasLineTax ? `<td class="n">${esc(l.effectiveTaxRate)}%</td>` : ''}
        <td class="n">${esc(groupMajor(minorToMajor(l.netMinor, v.currency)))}</td>
      </tr>`,
    )
    .join('');
  const t = v.totals;
  const docDiscountRow =
    t.discountMinor !== '0'
      ? `<tr><td>Discount${v.discount?.kind === 'percent' ? ` (${esc(v.discount.value)}%)` : ''}</td><td class="n">&minus;${money(v.currency, t.discount)}</td></tr>`
      : '';
  const taxRow =
    t.taxMinor !== '0'
      ? `<tr><td>Tax${!hasLineTax && v.taxRate !== '0' ? ` (${esc(v.taxRate)}%)` : ''}</td><td class="n">${money(v.currency, t.tax)}</td></tr>`
      : '';
  const colspan = 3 + (hasLineDiscount ? 1 : 0) + (hasLineTax ? 1 : 0);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(kindLabel)} ${esc(v.number)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111827; margin: 0; padding: 24px; }
  .page { max-width: 780px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #111827; padding-bottom: 12px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .muted { color: #6b7280; }
  .meta { text-align: right; }
  .block { margin: 18px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 6px; text-align: left; vertical-align: top; border-bottom: 1px solid #e5e7eb; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  .n { text-align: right; white-space: nowrap; }
  .totals { width: 50%; margin-left: auto; }
  .totals td { border-bottom: 0; padding: 4px 6px; }
  .totals .grand td { border-top: 2px solid #111827; font-weight: 700; font-size: 16px; padding-top: 8px; }
  pre { white-space: pre-wrap; font: inherit; margin: 0; }
  .signed { margin-top: 18px; font-size: 13px; }
  @media print { body { padding: 0; } }
</style></head>
<body><div class="page">
<header>
  <div><h1>${esc(v.title ?? kindLabel)}</h1><div class="muted">${esc(kindLabel)} ${esc(v.number)} &middot; ${esc(v.statusLabel)}</div></div>
  <div class="meta"><strong>${esc(v.sellerName)}</strong>${v.validUntil ? `<div class="muted">Valid until ${esc(v.validUntil)}</div>` : ''}</div>
</header>
${
  v.buyerName || v.buyerCompany
    ? `<div class="block"><div class="muted">Prepared for</div><div><strong>${esc(v.buyerName ?? '')}</strong>${v.buyerCompany ? `<div>${esc(v.buyerCompany)}</div>` : ''}</div></div>`
    : ''
}
<table>
  <thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th>${hasLineDiscount ? '<th class="n">Discount</th>' : ''}${hasLineTax ? '<th class="n">Tax</th>' : ''}<th class="n">Amount</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="${colspan + 1}" class="muted">No items.</td></tr>`}</tbody>
</table>
<table class="totals"><tbody>
  <tr><td>Subtotal</td><td class="n">${money(v.currency, t.subtotal)}</td></tr>
  ${docDiscountRow}${taxRow}
  <tr class="grand"><td>Total</td><td class="n">${money(v.currency, t.total)}</td></tr>
</tbody></table>
${v.notes ? `<div class="block"><div class="muted">Notes</div><pre>${esc(v.notes)}</pre></div>` : ''}
${v.terms ? `<div class="block"><div class="muted">Terms</div><pre>${esc(v.terms)}</pre></div>` : ''}
${v.signedBy ? `<div class="signed">Accepted by ${esc(v.signedBy)}.</div>` : ''}
</div></body></html>`;
}
