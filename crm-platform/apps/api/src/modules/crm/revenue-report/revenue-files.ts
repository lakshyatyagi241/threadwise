import {
  minorToMajor,
  type DealTotals,
  type RevenueGroup,
  type RevenueMetrics,
  type RevenuePeriodMoney,
  type RevenueReportResponse,
} from '@crm/contracts';
import { UTF8_BOM, csvLine, guardFormula } from '../contact-bulk/csv-writer';
import { groupDigits, money, PdfWriter, widthOf } from '../invoicing/invoice-render';
import type { LedgerRow } from './revenue-report.repository';

/**
 * The files of the revenue report (pure): the payment ledger CSV (Reference's file), the summary CSV (the table on screen) and the
 * PDF. The text is English whatever the viewer's language: a file leaves the app and is read by an accountant, a bank or an auditor.
 * The PDF is written by hand like the invoice PDF (Helvetica, Windows-1252): a name outside that alphabet prints as "?".
 */

// --- ledger CSV (Reference: Date, Amount, Currency, Method, Source, Invoice, Contact, Company, Reference) ---------------------------

/**
 * Reference's nine columns, in its order, then what its ledger did not have: the kind (payment or refund, a refund is negative), the
 * receipt number and the invoice owner. Date is the payment time in the zone the report was asked in.
 */
export const LEDGER_HEADER = [
  'Date',
  'Amount',
  'Currency',
  'Method',
  'Source',
  'Invoice',
  'Contact',
  'Company',
  'Reference',
  'Type',
  'Receipt',
  'Owner',
] as const;

export const ledgerCsvStart = (): string => `${UTF8_BOM}${csvLine([...LEDGER_HEADER])}`;

export function ledgerCsvLine(r: LedgerRow): string {
  return csvLine([
    r.paidLocal,
    minorToMajor(r.amount, r.currency),
    r.currency,
    r.method,
    r.source,
    guardFormula(r.invoiceNumber ?? ''),
    guardFormula(r.contactName ?? ''),
    guardFormula(r.companyName ?? ''),
    guardFormula(r.reference ?? ''),
    r.kind,
    guardFormula(r.receiptNumber ?? ''),
    guardFormula(r.ownerName ?? ''),
  ]);
}

// --- shared text -------------------------------------------------------------------------------------------------------------

const GROUP_TITLES: Record<RevenueGroup, string> = {
  source: 'Lead source',
  origin: 'Invoice origin',
  product: 'Product',
  owner: 'Owner',
  team: 'Team',
};

const EMPTY_LABEL: Record<RevenueGroup, string> = {
  source: 'No source',
  origin: 'Unknown',
  product: 'No line items',
  owner: 'Unassigned',
  team: 'No team',
};

const ORIGIN_LABELS: Record<string, string> = {
  manual: 'Manual',
  quote: 'From a quote',
  order: 'From an order',
  woocommerce: 'WooCommerce',
  shopify: 'Shopify',
  own: 'Own store',
  api: 'API',
  ai: 'AI',
};

/** What a row is called in a file. */
export function rowName(group: RevenueGroup, row: { key: string; label: string | null }): string {
  if (row.key === '') return EMPTY_LABEL[group];
  if (group === 'origin') return ORIGIN_LABELS[row.key] ?? row.key;
  return row.label ?? row.key;
}

const SPAN_LABELS: Record<string, string> = {
  previous: 'Previous period',
  lastYear: 'Same period last year',
};

// --- summary CSV --------------------------------------------------------------------------------------------------------------

const METRIC_ORDER = [
  'invoiced',
  'credited',
  'paid',
  'outstanding',
  'overdue',
  'collected',
  'refunded',
] as const satisfies ReadonlyArray<keyof RevenueMetrics>;

function currenciesOf(m: RevenueMetrics): string[] {
  const set = new Set<string>();
  for (const k of METRIC_ORDER)
    for (const side of [m[k].current, m[k].previous])
      for (const t of side?.byCurrency ?? []) set.add(t.currency);
  return [...set].sort();
}

const amountIn = (t: DealTotals | null, currency: string): string =>
  t?.byCurrency.find((x) => x.currency === currency)?.amount ?? '0';
const convertedOf = (t: DealTotals | null): string => t?.converted?.amount ?? '';

/**
 * The table on screen as a flat file: one line per group and currency (`Basis` actual), and with a target currency one more line
 * per group with the converted figures (`Basis` converted, blank where a currency had no exchange rate). The comparison columns
 * repeat the invoiced and collected figures of the comparison window.
 */
export function summaryCsv(report: RevenueReportResponse): string {
  const comparing = report.comparison !== null;
  const header: string[] = [
    GROUP_TITLES[report.rows.groupBy],
    'Basis',
    'Currency',
    'Invoices',
    'Invoiced',
    'Credited',
    'Paid',
    'Outstanding',
    'Overdue',
    'Collected',
    'Refunded',
  ];
  if (comparing)
    header.push('Invoices (comparison)', 'Invoiced (comparison)', 'Collected (comparison)');
  const lines: string[] = [UTF8_BOM + csvLine(header)];

  const emit = (
    name: string,
    metrics: RevenueMetrics,
    invoices: { current: number; previous: number | null },
  ) => {
    const cell = (k: (typeof METRIC_ORDER)[number], c: string) => amountIn(metrics[k].current, c);
    for (const c of currenciesOf(metrics)) {
      const row: Array<string | number> = [
        guardFormula(name),
        'actual',
        c,
        invoices.current,
        ...METRIC_ORDER.map((k) => cell(k, c)),
      ];
      if (comparing)
        row.push(
          invoices.previous ?? '',
          amountIn(metrics.invoiced.previous, c),
          amountIn(metrics.collected.previous, c),
        );
      lines.push(csvLine(row));
    }
    if (report.convertedTo) {
      const row: Array<string | number> = [
        guardFormula(name),
        'converted',
        report.convertedTo,
        invoices.current,
        ...METRIC_ORDER.map((k) => convertedOf(metrics[k].current)),
      ];
      if (comparing)
        row.push(
          invoices.previous ?? '',
          convertedOf(metrics.invoiced.previous),
          convertedOf(metrics.collected.previous),
        );
      lines.push(csvLine(row));
    }
  };

  emit('Total', report.summary.metrics, report.summary.invoices.issued);
  for (const r of report.rows.items) emit(rowName(report.rows.groupBy, r), r.metrics, r.invoices);
  return lines.join('');
}

// --- PDF ---------------------------------------------------------------------------------------------------------------------

const GREY: [number, number, number] = [0.42, 0.4, 0.35];
const ACCENT: [number, number, number] = [0.04, 0.24, 0.18];
const CORAL: [number, number, number] = [0.7, 0.25, 0.18];

/** One total as text: the converted figure when there is one, else every currency present. */
export function totalsText(t: DealTotals | null, fallbackCurrency: string): string {
  if (!t) return '';
  if (t.converted) return money(t.converted.amount, t.converted.currency);
  if (t.byCurrency.length === 0) return money('0', fallbackCurrency);
  return t.byCurrency.map((m) => money(m.amount, m.currency)).join(' + ');
}

/** One line per currency (or the one converted figure), for a table cell. */
function moneyLines(t: DealTotals, fallbackCurrency: string): string[] {
  if (t.converted) return [money(t.converted.amount, t.converted.currency)];
  if (t.byCurrency.length === 0) return [money('0', fallbackCurrency)];
  return t.byCurrency.map((m) => money(m.amount, m.currency));
}

/** Cuts text to a width, with an ellipsis (three dots) when it does not fit. */
function fit(text: string, width: number, size: number, bold = false): string {
  if (widthOf(text, size, bold) <= width) return text;
  let out = text;
  while (out.length > 1 && widthOf(`${out}...`, size, bold) > width) out = out.slice(0, -1);
  return `${out}...`;
}

export interface PdfInput {
  report: RevenueReportResponse;
  /** The workspace name, printed on the first line (Reference printed the product's brand name). */
  brand: string;
  /** `d Mon yyyy, HH:mm` in the report's zone. */
  generatedAt: string;
}

/** The report as a PDF: the key figures against the comparison, the table by group, the collected-by-bucket list and the aging. */
export function renderRevenuePdf({ report, brand, generatedAt }: PdfInput): Buffer {
  const w = new PdfWriter();
  const fallback = report.convertedTo ?? report.currencies[0] ?? 'USD';
  const { summary } = report;

  w.text(`${brand} - Revenue report`, w.left, 17, { bold: true, color: ACCENT });
  w.y -= 17;
  w.text(
    `Period ${report.period.fromDate} to ${report.period.toDate} (${report.period.timezone})`,
    w.left,
    9.5,
  );
  w.y -= 12;
  if (report.comparison) {
    w.text(
      `Compared with ${SPAN_LABELS[report.comparison.mode] ?? report.comparison.mode}: ${report.comparison.fromDate} to ${report.comparison.toDate}`,
      w.left,
      9.5,
    );
    w.y -= 12;
  }
  w.text(
    `Generated ${generatedAt}` +
      (report.convertedTo ? `   Shown in ${report.convertedTo}` : '') +
      (report.mixedCurrency
        ? '   Several currencies: totals are listed per currency, never added'
        : ''),
    w.left,
    8.5,
    { color: GREY },
  );
  w.y -= 12;
  w.rule(1.2, 0.2);
  w.y -= 20;

  // key figures: label, this period, comparison. Reference's four first, then what the new report adds.
  const figures: Array<[string, RevenuePeriodMoney, [number, number, number]?]> = [
    ['Collected', summary.metrics.collected, ACCENT],
    ['Collected, all time', { current: summary.collectedAllTime, previous: null }],
    [
      'Outstanding now (all open invoices)',
      { current: summary.receivables.outstanding, previous: null },
      CORAL,
    ],
    ['Tax on invoices paid in full', summary.taxCollected],
    ['Invoiced', summary.metrics.invoiced],
    ['Paid so far (of invoiced)', summary.metrics.paid],
    ['Owed now (of invoiced)', summary.metrics.outstanding, CORAL],
    ['Overdue now (of invoiced)', summary.metrics.overdue, CORAL],
    ['Refunded', summary.metrics.refunded],
    ['Credit notes', summary.metrics.credited],
  ];
  const col2 = 330;
  w.text('KEY FIGURES', w.left, 8, { bold: true, color: GREY });
  w.text('This period', col2, 8, { bold: true, color: GREY, align: 'right' });
  if (report.comparison)
    w.text('Comparison', w.right, 8, { bold: true, color: GREY, align: 'right' });
  w.y -= 6;
  w.rule();
  w.y -= 14;
  for (const [label, m, color] of figures) {
    w.ensure(16);
    w.text(label, w.left, 10);
    w.text(fit(totalsText(m.current, fallback), 200, 10, true), col2 + 20, 10, {
      bold: true,
      align: 'right',
      color,
    });
    if (report.comparison)
      w.text(fit(totalsText(m.previous, fallback), 200, 10), w.right, 10, {
        align: 'right',
        color: GREY,
      });
    w.y -= 15;
  }
  w.ensure(16);
  w.text(
    `Invoices issued: ${summary.invoices.issued.current}` +
      `   Paid in full: ${summary.invoices.paidInFull.current}` +
      `   Open now: ${summary.receivables.invoices}` +
      `   Overdue now: ${totalsText(summary.receivables.overdue, fallback)}`,
    w.left,
    9,
    { color: GREY },
  );
  w.y -= 22;

  // the table by group
  const group = report.rows.groupBy;
  const cols = { invoiced: 285, paid: 370, outstanding: 455, collected: w.right } as const;
  w.ensure(60);
  w.text(`BY ${GROUP_TITLES[group].toUpperCase()}`, w.left, 8, { bold: true, color: GREY });
  w.text('Invoiced', cols.invoiced, 8, { bold: true, color: GREY, align: 'right' });
  w.text('Paid', cols.paid, 8, { bold: true, color: GREY, align: 'right' });
  w.text('Owed', cols.outstanding, 8, { bold: true, color: GREY, align: 'right' });
  w.text('Collected', cols.collected, 8, { bold: true, color: GREY, align: 'right' });
  w.y -= 6;
  w.rule();
  w.y -= 13;
  if (report.rows.items.length === 0) {
    w.text('Nothing was invoiced or collected in this period.', w.left, 9.5, { color: GREY });
    w.y -= 14;
  }
  for (const r of report.rows.items) {
    const cells: Array<[keyof typeof cols, string[]]> = [
      ['invoiced', moneyLines(r.metrics.invoiced.current, fallback)],
      ['paid', moneyLines(r.metrics.paid.current, fallback)],
      ['outstanding', moneyLines(r.metrics.outstanding.current, fallback)],
      ['collected', moneyLines(r.metrics.collected.current, fallback)],
    ];
    const lines = Math.max(1, ...cells.map(([, l]) => l.length));
    w.ensure(lines * 11 + 4);
    const top = w.y;
    w.text(fit(rowName(group, r), 135, 9), w.left, 9);
    for (const [c, list] of cells)
      list.forEach((text, j) => {
        w.y = top - j * 11;
        w.text(fit(text, 82, 8), cols[c], 8, { align: 'right' });
      });
    w.y = top - lines * 11 - 3;
  }
  if (report.rows.truncated) {
    w.text('Only the biggest rows are listed. The CSV summary has the same rows.', w.left, 8, {
      color: GREY,
    });
    w.y -= 12;
  }
  w.y -= 12;

  // collected and invoiced per bucket
  w.ensure(40);
  w.text(`BY ${report.trend.bucket.toUpperCase()}`, w.left, 8, { bold: true, color: GREY });
  w.text('Invoiced', 400, 8, { bold: true, color: GREY, align: 'right' });
  w.text('Collected', w.right, 8, { bold: true, color: GREY, align: 'right' });
  w.y -= 6;
  w.rule();
  w.y -= 13;
  for (const p of report.trend.points) {
    w.ensure(14);
    w.text(p.start, w.left, 9);
    w.text(fit(totalsText(p.invoiced, fallback), 150, 9), 400, 9, { align: 'right' });
    w.text(fit(totalsText(p.collected, fallback), 150, 9), w.right, 9, { align: 'right' });
    w.y -= 13;
  }
  w.y -= 12;

  // receivables aging, per currency
  w.ensure(40);
  w.text(`RECEIVABLES AGING AS OF ${report.aging.asOf}`, w.left, 8, { bold: true, color: GREY });
  w.y -= 6;
  w.rule();
  w.y -= 13;
  const bucketTitle: Record<string, string> = {
    current: 'Not yet due',
    d1_30: '1-30 days',
    d31_60: '31-60 days',
    d61_90: '61-90 days',
    d90_plus: '90+ days',
  };
  if (report.aging.currencies.length === 0) {
    w.text('Nothing is owed.', w.left, 9.5, { color: GREY });
    w.y -= 14;
  }
  for (const block of report.aging.currencies) {
    w.ensure(30 + block.buckets.length * 13);
    w.text(
      `${block.currency}   ${block.invoices} invoice${block.invoices === 1 ? '' : 's'}   ${groupDigits(block.total)} owed`,
      w.left,
      9.5,
      { bold: true },
    );
    w.y -= 13;
    for (const b of block.buckets) {
      w.text(bucketTitle[b.bucket] ?? b.bucket, w.left + 10, 9);
      w.text(String(b.invoices), 340, 9, { align: 'right', color: GREY });
      w.text(groupDigits(b.amount), w.right, 9, {
        align: 'right',
        color: b.bucket === 'd90_plus' ? CORAL : undefined,
      });
      w.y -= 13;
    }
    w.y -= 6;
  }
  return w.build();
}
