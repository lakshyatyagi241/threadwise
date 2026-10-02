import { createHash, randomBytes } from 'node:crypto';
import { daysBetween } from '@crm/contracts';

/**
 * Pure rules of invoicing: numbering, dates, the public token, and the over-payment decision. Nothing here touches the database,
 * so each rule is unit-tested in isolation (test/unit/invoicing).
 */

export type InvoiceDocType = 'tax_invoice' | 'proforma' | 'receipt';

/** Everything that is numbered from a series: the invoice types, credit notes and sales orders. */
export type NumberedDocType = InvoiceDocType | 'credit_note' | 'sales_order';

export interface NumberingSettings {
  numberingPrefix: string;
  proformaPrefix: string;
  receiptPrefix: string;
  creditNotePrefix: string;
  salesOrderPrefix: string;
  numberFormat: string;
  numberPadding: number;
  yearlyReset: boolean;
  fiscalYearStartMonth: number;
}

export const DEFAULT_NUMBERING: NumberingSettings = {
  numberingPrefix: 'INV',
  proformaPrefix: 'PRO',
  receiptPrefix: 'RCT',
  creditNotePrefix: 'CRN',
  salesOrderPrefix: 'SO',
  numberFormat: '{PREFIX}-{YEAR}-{SEQ}',
  numberPadding: 6,
  yearlyReset: true,
  fiscalYearStartMonth: 1,
};

/**
 * The year a document belongs to in the numbering. With a January fiscal year it is the calendar year; with another start month
 * it is the year the fiscal year STARTED in (April 2026 to March 2027 is "2026"). WaDesk hard-coded India's April start for every
 * workspace and flipped the label on 1 April everywhere.
 */
export function numberingYear(date: string, fiscalYearStartMonth: number): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= fiscalYearStartMonth ? year : year - 1;
}

export function prefixFor(docType: NumberedDocType, s: NumberingSettings): string {
  if (docType === 'proforma') return s.proformaPrefix;
  if (docType === 'receipt') return s.receiptPrefix;
  if (docType === 'credit_note') return s.creditNotePrefix;
  if (docType === 'sales_order') return s.salesOrderPrefix;
  return s.numberingPrefix;
}

/**
 * The counter a number comes from. Each document type has its own series (a gap-free tax-invoice run is a legal requirement in
 * several regimes, and WaDesk let receipts eat its numbers), and the series changes with the numbering year when the counter
 * restarts yearly. The format decides how the series and the sequence are WRITTEN; the series decides who shares a counter.
 */
export function seriesKey(docType: NumberedDocType, s: NumberingSettings, date: string): string {
  const prefix = prefixFor(docType, s);
  return s.yearlyReset ? `${prefix}-${numberingYear(date, s.fiscalYearStartMonth)}` : prefix;
}

/** `{PREFIX}-{YEAR}-{SEQ}` + INV, 2026, 7, padding 6 -> `INV-2026-000007` (more digits when the sequence is larger). */
export function formatNumber(
  docType: NumberedDocType,
  s: NumberingSettings,
  date: string,
  seq: number,
): string {
  const year = numberingYear(date, s.fiscalYearStartMonth);
  return s.numberFormat
    .replaceAll('{PREFIX}', prefixFor(docType, s))
    .replaceAll('{YEAR}', String(year))
    .replaceAll('{YY}', String(year % 100).padStart(2, '0'))
    .replaceAll('{SEQ}', String(seq).padStart(s.numberPadding, '0'));
}

/**
 * Two numberings that restart every year but print no year would hand out the same text twice (INV-000001 in 2026 and again in
 * 2027), and the number is unique per workspace. A format must therefore carry the year when the counter restarts yearly.
 */
export function numberFormatProblem(format: string, yearlyReset: boolean): string | null {
  if (!format.includes('{SEQ}')) return 'the format must contain {SEQ}';
  if (yearlyReset && !format.includes('{YEAR}') && !format.includes('{YY}')) {
    return 'a format without {YEAR} or {YY} cannot restart every year: its numbers would repeat';
  }
  return null;
}

// --- dates -----------------------------------------------------------------------------------------------------------------

export function addDays(date: string, days: number): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + days));
  return d.toISOString().slice(0, 10);
}

/**
 * The due date of an invoice being issued: an explicit date wins, then explicit terms in days, then the workspace default terms;
 * with none of them the invoice is due on its issue date. Never before the issue date.
 */
export function resolveDueDate(opts: {
  issueDate: string;
  dueDate?: string | null;
  termsDays?: number | null;
  defaultDueDays?: number | null;
}): string {
  if (opts.dueDate) return opts.dueDate < opts.issueDate ? opts.issueDate : opts.dueDate;
  const days = opts.termsDays ?? opts.defaultDueDays ?? 0;
  return addDays(opts.issueDate, days);
}

/** Days past due on `today` (positive when late) for an open balance: the due date, or the issue date when there is none. */
export function daysPastDue(
  dueDate: string | null,
  issueDate: string | null,
  today: string,
): number | null {
  const ref = dueDate ?? issueDate;
  return ref ? daysBetween(ref, today) : null;
}

// --- public token ----------------------------------------------------------------------------------------------------------

/** 256 bits of randomness, URL-safe. Only its SHA-256 is searchable; an encrypted copy lets staff copy the link again. */
export function newPublicToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPublicToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A token as the URL carries it: 43 base64url characters, nothing else (so junk never reaches the database). */
export const isPlausibleToken = (token: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(token);

// --- over-payment ----------------------------------------------------------------------------------------------------------

export type PaymentDecision =
  { ok: true; creditMinor: bigint } | { ok: false; reason: 'overpayment'; balanceMinor: bigint };

/**
 * Decides whether `amountMinor` may be recorded against an invoice with `balanceMinor` open. More than the balance is refused
 * unless the caller said it is intended, in which case the excess is carried as a credit on the invoice (`paid - total`).
 */
export function decidePayment(
  balanceMinor: bigint,
  amountMinor: bigint,
  allowOverpayment: boolean,
): PaymentDecision {
  const open = balanceMinor > 0n ? balanceMinor : 0n;
  if (amountMinor <= open) return { ok: true, creditMinor: 0n };
  if (!allowOverpayment) return { ok: false, reason: 'overpayment', balanceMinor: open };
  return { ok: true, creditMinor: amountMinor - open };
}
