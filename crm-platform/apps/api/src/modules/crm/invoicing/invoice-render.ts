import type { PublicInvoice } from '@crm/contracts';

/**
 * Renders an invoice for people: a printable HTML page and a PDF (WD-INV-014/015/017, D-16). Both are PURE functions of the document
 * the public view carries, which is built from the frozen invoice, so an issued invoice always renders the same bytes and nothing
 * is stored (WaDesk rendered once, froze the file, and read live branding at the first render).
 *
 * The PDF is written by hand (Helvetica, WinAnsi): no PDF library, no browser, no network, nothing a buyer-controlled string can
 * make the server fetch. Its limit is the alphabet: characters outside Windows-1252 print as "?" (the HTML page has no such limit).
 */

// --- shared ------------------------------------------------------------------------------------------------------------------

const DOC_TITLES: Record<string, string> = {
  tax_invoice: 'Tax Invoice',
  proforma: 'Proforma Invoice',
  receipt: 'Receipt',
};

export const titleOf = (inv: Pick<PublicInvoice, 'docType' | 'title'>): string =>
  inv.title || DOC_TITLES[inv.docType] || 'Invoice';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  issued: 'Issued',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
};
export const statusLabel = (s: string): string => STATUS_LABELS[s] ?? s;

/** "1234.5" -> "1,234.5": groups the whole part and keeps the decimals the currency carries. */
export function groupDigits(amount: string): string {
  const neg = amount.startsWith('-');
  const [whole, frac] = (neg ? amount.slice(1) : amount).split('.');
  const g = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${g}${frac !== undefined ? `.${frac}` : ''}`;
}

/** The currency code goes first and no symbol is used: a symbol is not in every font and means different things in different countries. */
export const money = (amount: string, currency: string): string => `${currency} ${groupDigits(amount)}`;

const esc = (v: string | null | undefined): string =>
  (v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const nl = (v: string | null | undefined): string => esc(v).replace(/\r?\n/g, '<br>');

function sellerLines(inv: PublicInvoice): string[] {
  const s = inv.seller;
  const lines: string[] = [];
  if (s.address) lines.push(...s.address.split(/\r?\n/));
  if (s.taxId) lines.push(`Tax ID: ${s.taxId}`);
  if (s.registrationNo) lines.push(`Reg. no: ${s.registrationNo}`);
  for (const e of s.extra) lines.push(`${e.label}: ${e.value}`);
  if (s.phone) lines.push(s.phone);
  if (s.email) lines.push(s.email);
  return lines;
}

// --- HTML --------------------------------------------------------------------------------------------------------------------

export function renderInvoiceHtml(inv: PublicInvoice): string {
  const cur = inv.currency;
  const brand = inv.brandColor && /^#[0-9A-Fa-f]{6}$/.test(inv.brandColor) ? inv.brandColor : '#0B3D2E';
  const taxed = inv.lines.some((l) => l.taxRate !== '0');
  const rows = inv.lines
    .map(
      (l) => `<tr><td>${esc(l.description)}${l.sku ? `<div class="muted">${esc(l.sku)}</div>` : ''}${
        l.hsnSac ? `<div class="muted">HSN/SAC ${esc(l.hsnSac)}</div>` : ''
      }</td><td class="num">${esc(l.qty)}</td><td class="num">${esc(groupDigits(l.unitPrice))}</td>${
        l.discount ? `<td class="num">${esc(l.discount.kind === 'percent' ? `${l.discount.value}%` : groupDigits(l.discount.value))}</td>` : '<td></td>'
      }${taxed ? `<td class="num">${l.taxRate !== '0' ? esc(`${l.taxName ?? 'Tax'} ${l.taxRate}%`) : ''}</td>` : ''}<td class="num">${esc(
        groupDigits(l.amounts.total),
      )}</td></tr>`,
    )
    .join('');
  const taxRows = inv.taxSummary
    .map(
      (t) =>
        `<tr><td>${esc(t.name)} ${esc(t.rate)}%${t.inclusive ? ' (included)' : ''}</td><td class="num">${esc(groupDigits(t.base))}</td><td class="num">${esc(groupDigits(t.tax))}</td></tr>` +
        (t.components ?? [])
          .map((c) => `<tr class="sub"><td>&nbsp;&nbsp;${esc(c.type)} ${esc(c.rate)}%</td><td></td><td class="num">${esc(groupDigits(c.amount))}</td></tr>`)
          .join(''),
    )
    .join('');
  const payments = inv.payments
    .map(
      (p) =>
        `<tr><td>${esc(p.paidAt.slice(0, 10))}</td><td>${esc(p.kind === 'refund' ? 'Refund' : 'Payment')} (${esc(p.method)})${p.receiptNumber ? ` ${esc(p.receiptNumber)}` : ''}</td><td class="num">${esc(groupDigits(p.amount))}</td></tr>`,
    )
    .join('');
  const banner =
    inv.status === 'void'
      ? `<div class="banner void">This invoice was voided${inv.voidReason ? `: ${esc(inv.voidReason)}` : ''}.</div>`
      : inv.status === 'paid'
        ? '<div class="banner paid">Paid in full. Thank you.</div>'
        : inv.status === 'overdue'
          ? '<div class="banner overdue">This invoice is past its due date.</div>'
          : '';
  const bank = inv.paymentOptions.bankTransfer;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(titleOf(inv))} ${esc(inv.number)}</title>
<style>
body{font:14px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:0;background:#f4f5f6}
.page{max-width:820px;margin:24px auto;background:#fff;padding:36px 40px;border-top:6px solid ${brand}}
h1{margin:0;font-size:24px;color:${brand}} .muted{color:#6b7280;font-size:12px} .head{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
table{width:100%;border-collapse:collapse;margin:18px 0} th{text-align:left;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb;padding:6px 4px}
td{padding:7px 4px;border-bottom:1px solid #eef0f2;vertical-align:top} .num{text-align:right;white-space:nowrap} th.num{text-align:right}
.tot td{border:0;padding:3px 4px} .tot .grand td{font-weight:700;font-size:16px;border-top:2px solid #e5e7eb} .sub td{color:#6b7280;font-size:12px;border:0;padding:0 4px}
.banner{padding:10px 14px;border-radius:6px;margin:14px 0;font-weight:600} .void{background:#fee2e2;color:#991b1b} .paid{background:#dcfce7;color:#166534} .overdue{background:#fef3c7;color:#92400e}
.box{background:#f9fafb;border-radius:6px;padding:12px 14px;margin-top:14px} @media print{body{background:#fff}.page{margin:0;border:0;padding:0}}
</style></head><body><div class="page">
<div class="head"><div>${inv.logoUrl && inv.logoUrl.startsWith('https://') ? `<img src="${esc(inv.logoUrl)}" alt="" style="max-height:56px;max-width:200px"><br>` : ''}<strong>${esc(inv.seller.name)}</strong><div class="muted">${sellerLines(inv).map(esc).join('<br>')}</div></div>
<div style="text-align:right"><h1>${esc(titleOf(inv))}</h1><div><strong>${esc(inv.number)}</strong></div><div class="muted">${esc(statusLabel(inv.status))}</div>
<div class="muted">Issued ${esc(inv.issueDate)}${inv.dueDate ? ` &middot; Due ${esc(inv.dueDate)}` : ''}</div>${inv.reference ? `<div class="muted">Ref: ${esc(inv.reference)}</div>` : ''}</div></div>
${banner}
<div class="box"><div class="muted">Bill to</div><strong>${esc(inv.buyer.name ?? 'Customer')}</strong>${inv.buyer.address ? `<div>${nl(inv.buyer.address)}</div>` : ''}${inv.buyer.taxId ? `<div class="muted">Tax ID: ${esc(inv.buyer.taxId)}</div>` : ''}</div>
<table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Discount</th>${taxed ? '<th class="num">Tax</th>' : ''}<th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot" style="width:320px;margin-left:auto"><tbody>
<tr><td>Subtotal</td><td class="num">${esc(groupDigits(inv.amounts.subtotal))}</td></tr>
${inv.amounts.discount !== '0' && !/^0(\.0+)?$/.test(inv.amounts.discount) ? `<tr><td>Discount</td><td class="num">-${esc(groupDigits(inv.amounts.discount))}</td></tr>` : ''}
${!/^0(\.0+)?$/.test(inv.amounts.shipping) ? `<tr><td>Shipping</td><td class="num">${esc(groupDigits(inv.amounts.shipping))}</td></tr>` : ''}
${!/^0(\.0+)?$/.test(inv.amounts.taxAdded) ? `<tr><td>Tax</td><td class="num">${esc(groupDigits(inv.amounts.taxAdded))}</td></tr>` : ''}
<tr class="grand"><td>Total (${esc(cur)})</td><td class="num">${esc(groupDigits(inv.amounts.total))}</td></tr>
${!/^0(\.0+)?$/.test(inv.amounts.paid) ? `<tr><td>Paid</td><td class="num">-${esc(groupDigits(inv.amounts.paid))}</td></tr><tr><td><strong>Balance due</strong></td><td class="num"><strong>${esc(groupDigits(inv.amounts.balance))}</strong></td></tr>` : ''}
</tbody></table>
${taxRows ? `<table><thead><tr><th>Tax summary</th><th class="num">Taxable</th><th class="num">Tax</th></tr></thead><tbody>${taxRows}</tbody></table>` : ''}
${inv.reverseCharge ? '<p class="muted">Reverse charge: the recipient accounts for the tax.</p>' : ''}
${payments ? `<table><thead><tr><th>Date</th><th>Payments received</th><th class="num">Amount</th></tr></thead><tbody>${payments}</tbody></table>` : ''}
${inv.payable && bank ? `<div class="box"><strong>How to pay</strong>${bank.instructions ? `<div>${nl(bank.instructions)}</div>` : ''}${
    bank.details ? `<div class="muted">${Object.entries(bank.details).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('<br>')}</div>` : ''
  }</div>` : ''}
${inv.notes ? `<div class="box"><strong>Notes</strong><div>${nl(inv.notes)}</div></div>` : ''}
${inv.terms ? `<div class="box"><strong>Terms</strong><div class="muted">${nl(inv.terms)}</div></div>` : ''}
${inv.legalNotes ? `<p class="muted">${nl(inv.legalNotes)}</p>` : ''}
${inv.footerNote ? `<p class="muted">${nl(inv.footerNote)}</p>` : ''}
</div></body></html>`;
}

// --- PDF ---------------------------------------------------------------------------------------------------------------------

/** Helvetica advance widths (per 1000 em) for ASCII 32..126. */
const W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667,
  611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833,
  556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Windows-1252 bytes for the few characters outside Latin-1 that commonly appear; anything else becomes "?". */
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85,
};

function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.replace(/[\r\n\t]+/g, ' ')) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c <= 126) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else out.push(CP1252[c] ?? 63);
  }
  return out;
}

const widthOf = (text: string, size: number, bold: boolean): number => {
  let w = 0;
  for (const b of toWinAnsi(text)) w += b >= 32 && b <= 126 ? W[b - 32]! : 556;
  return (w / 1000) * size * (bold ? 1.06 : 1);
};

function wrap(text: string, maxWidth: number, size: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(' ')) {
      const trial = line ? `${line} ${word}` : word;
      if (widthOf(trial, size, bold) <= maxWidth || !line) line = trial;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

class Page {
  ops: string[] = [];
}

class PdfWriter {
  pages: Page[] = [new Page()];
  y = 802;
  readonly left = 40;
  readonly right = 555;

  private get page(): Page {
    return this.pages[this.pages.length - 1]!;
  }

  ensure(h: number): void {
    if (this.y - h < 50) {
      this.pages.push(new Page());
      this.y = 802;
    }
  }

  private encode(text: string): string {
    return toWinAnsi(text)
      .map((b) => (b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 127 && b >= 32 ? String.fromCharCode(b) : `\\${b.toString(8).padStart(3, '0')}`))
      .join('');
  }

  text(text: string, x: number, size = 10, opts: { bold?: boolean; align?: 'left' | 'right'; color?: [number, number, number] } = {}): void {
    const bold = opts.bold ?? false;
    const px = opts.align === 'right' ? x - widthOf(text, size, bold) : x;
    const [r, g, b] = opts.color ?? [0.1, 0.1, 0.1];
    this.page.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${r} ${g} ${b} rg ${px.toFixed(2)} ${this.y.toFixed(2)} Td (${this.encode(text)}) Tj ET`);
  }

  rule(width = 0.5, gray = 0.8): void {
    this.page.ops.push(`${gray} G ${width} w ${this.left} ${this.y.toFixed(2)} m ${this.right} ${this.y.toFixed(2)} l S`);
  }

  build(): Buffer {
    const objs: Buffer[] = [];
    const add = (s: string | Buffer): number => {
      objs.push(Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1'));
      return objs.length;
    };
    add('<< /Type /Catalog /Pages 2 0 R >>');
    const kids = this.pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
    add(`<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`);
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    this.pages.forEach((p, i) => {
      const content = p.ops.join('\n');
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
      );
      add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    });
    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
    const offsets: number[] = [];
    let pos = parts[0]!.length;
    objs.forEach((o, i) => {
      offsets.push(pos);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), o, Buffer.from('\nendobj\n', 'latin1')]);
      parts.push(b);
      pos += b.length;
    });
    const xref =
      `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
      offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
      `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
  }
}

export function renderInvoicePdf(inv: PublicInvoice): Buffer {
  const w = new PdfWriter();
  const cur = inv.currency;
  const brand = ((): [number, number, number] => {
    const m = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(inv.brandColor ?? '');
    return m ? [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255] : [0.04, 0.24, 0.18];
  })();

  // header: seller on the left, title and number on the right
  w.text(titleOf(inv).toUpperCase(), w.right, 18, { bold: true, align: 'right', color: brand });
  w.text(inv.seller.name ?? '', w.left, 13, { bold: true });
  w.y -= 18;
  w.text(`${inv.number}   ${statusLabel(inv.status)}`, w.right, 10, { bold: true, align: 'right' });
  for (const l of sellerLines(inv)) {
    for (const part of wrap(l, 280, 9)) {
      w.text(part, w.left, 9, { color: [0.35, 0.35, 0.35] });
      w.y -= 12;
    }
  }
  w.text(`Issued ${inv.issueDate}${inv.dueDate ? `   Due ${inv.dueDate}` : ''}`, w.right, 9, { align: 'right', color: [0.35, 0.35, 0.35] });
  w.y -= 12;
  if (inv.reference) {
    w.text(`Ref: ${inv.reference}`, w.right, 9, { align: 'right', color: [0.35, 0.35, 0.35] });
    w.y -= 12;
  }
  w.y -= 8;
  w.rule(1.2, 0.2);
  w.y -= 18;

  w.text('BILL TO', w.left, 8, { color: [0.45, 0.45, 0.45] });
  w.y -= 13;
  w.text(inv.buyer.name ?? 'Customer', w.left, 11, { bold: true });
  w.y -= 14;
  for (const l of [...(inv.buyer.address ? inv.buyer.address.split(/\r?\n/) : []), ...(inv.buyer.taxId ? [`Tax ID: ${inv.buyer.taxId}`] : [])]) {
    w.text(l, w.left, 9);
    w.y -= 12;
  }
  w.y -= 8;

  // lines
  const colQty = 360;
  const colUnit = 430;
  const colAmt = w.right;
  const header = () => {
    w.text('Description', w.left, 8, { bold: true, color: [0.4, 0.4, 0.4] });
    w.text('Qty', colQty, 8, { bold: true, align: 'right', color: [0.4, 0.4, 0.4] });
    w.text('Unit price', colUnit, 8, { bold: true, align: 'right', color: [0.4, 0.4, 0.4] });
    w.text(`Amount (${cur})`, colAmt, 8, { bold: true, align: 'right', color: [0.4, 0.4, 0.4] });
    w.y -= 6;
    w.rule();
    w.y -= 13;
  };
  header();
  for (const l of inv.lines) {
    const desc = wrap(l.description, 290, 9.5);
    const extra: string[] = [];
    if (l.hsnSac) extra.push(`HSN/SAC ${l.hsnSac}`);
    if (l.discount) extra.push(`Discount ${l.discount.kind === 'percent' ? `${l.discount.value}%` : groupDigits(l.discount.value)}`);
    if (l.taxRate !== '0') extra.push(`${l.taxName ?? 'Tax'} ${l.taxRate}%${l.taxInclusive ? ' incl.' : ''}`);
    const height = (desc.length + (extra.length ? 1 : 0)) * 12 + 6;
    w.ensure(height);
    w.text(l.qty, colQty, 9.5, { align: 'right' });
    w.text(groupDigits(l.unitPrice), colUnit, 9.5, { align: 'right' });
    w.text(groupDigits(l.amounts.total), colAmt, 9.5, { align: 'right' });
    for (const part of desc) {
      w.text(part, w.left, 9.5);
      w.y -= 12;
    }
    if (extra.length) {
      w.text(extra.join('  -  '), w.left, 8, { color: [0.45, 0.45, 0.45] });
      w.y -= 12;
    }
    w.y -= 2;
  }
  w.rule();
  w.y -= 16;

  // totals
  const zero = (v: string) => /^0(\.0+)?$/.test(v);
  const total = (label: string, value: string, bold = false) => {
    w.ensure(16);
    w.text(label, 430, bold ? 11 : 9.5, { bold, align: 'right' });
    w.text(value, w.right, bold ? 11 : 9.5, { bold, align: 'right' });
    w.y -= bold ? 17 : 14;
  };
  total('Subtotal', groupDigits(inv.amounts.subtotal));
  if (!zero(inv.amounts.discount)) total('Discount', `-${groupDigits(inv.amounts.discount)}`);
  if (!zero(inv.amounts.shipping)) total('Shipping', groupDigits(inv.amounts.shipping));
  if (!zero(inv.amounts.taxAdded)) total('Tax', groupDigits(inv.amounts.taxAdded));
  total(`Total ${cur}`, groupDigits(inv.amounts.total), true);
  if (!zero(inv.amounts.paid)) {
    total('Paid', `-${groupDigits(inv.amounts.paid)}`);
    total('Balance due', groupDigits(inv.amounts.balance), true);
  }
  w.y -= 6;

  if (inv.taxSummary.length) {
    w.ensure(30 + inv.taxSummary.length * 12);
    w.text('TAX SUMMARY', w.left, 8, { bold: true, color: [0.4, 0.4, 0.4] });
    w.y -= 13;
    for (const t of inv.taxSummary) {
      w.text(`${t.name} ${t.rate}%${t.inclusive ? ' (included)' : ''}`, w.left, 9);
      w.text(groupDigits(t.base), 400, 9, { align: 'right' });
      w.text(groupDigits(t.tax), w.right, 9, { align: 'right' });
      w.y -= 12;
      for (const c of t.components ?? []) {
        w.text(`   ${c.type} ${c.rate}%`, w.left, 8, { color: [0.45, 0.45, 0.45] });
        w.text(groupDigits(c.amount), w.right, 8, { align: 'right', color: [0.45, 0.45, 0.45] });
        w.y -= 11;
      }
    }
    w.y -= 6;
  }
  if (inv.reverseCharge) {
    w.ensure(14);
    w.text('Reverse charge: the recipient accounts for the tax.', w.left, 9);
    w.y -= 14;
  }
  const blocks: Array<[string, string]> = [];
  const bank = inv.paymentOptions.bankTransfer;
  if (inv.payable && bank) {
    const detail = bank.details ? Object.entries(bank.details).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
    blocks.push(['HOW TO PAY', [bank.instructions, detail].filter(Boolean).join('\n')]);
  }
  if (inv.notes) blocks.push(['NOTES', inv.notes]);
  if (inv.terms) blocks.push(['TERMS', inv.terms]);
  if (inv.legalNotes) blocks.push(['', inv.legalNotes]);
  if (inv.footerNote) blocks.push(['', inv.footerNote]);
  for (const [label, body] of blocks) {
    const lines = wrap(body, w.right - w.left, 9);
    w.ensure(14 + lines.length * 12);
    if (label) {
      w.text(label, w.left, 8, { bold: true, color: [0.4, 0.4, 0.4] });
      w.y -= 13;
    }
    for (const l of lines) {
      w.text(l, w.left, 9, { color: [0.25, 0.25, 0.25] });
      w.y -= 12;
    }
    w.y -= 6;
  }
  return w.build();
}
