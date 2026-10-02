/**
 * The per-recipient CSV of a broadcast (TW-BCAST-037). Pure.
 *
 * Columns, in order: Recipient, Phone, Status, Clicked, Queued, Sent, Delivered, Read, Failed, Last event, Error.
 */
export const CSV_HEADER = [
  'Recipient',
  'Phone',
  'Status',
  'Clicked',
  'Queued',
  'Sent',
  'Delivered',
  'Read',
  'Failed',
  'Last event',
  'Error',
] as const;

/** RFC 4180: a cell with a comma, quote or line break is quoted, quotes doubled. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvLine = (cells: ReadonlyArray<string | number | null | undefined>) =>
  `${cells.map(csvCell).join(',')}\n`;

/** A text cell that begins with = + - or @ is read by a spreadsheet as a formula, so it gets a leading apostrophe. */
export const guardFormula = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

/** `YYYY-MM-DD HH:mm` in `zone`; blank for no time. */
export function localMinute(date: Date | null | undefined, zone: string): string {
  if (!date) return '';
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export interface CsvRecipient {
  name: string;
  /** Digits only. */
  phoneDigits: string;
  status: string;
  clicked: boolean;
  queuedAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  /** When the recipient failed (its last update). */
  failedAt: Date | null;
  error: string | null;
}

/** The most advanced thing that happened to the recipient. */
export function lastEvent(r: CsvRecipient): string {
  if (r.clicked) return 'Button tap';
  if (r.readAt) return 'Read';
  if (r.deliveredAt) return 'Delivered';
  if (r.sentAt) return 'Sent';
  if (r.failedAt) return 'Failed';
  return 'Queued';
}

export function csvRow(r: CsvRecipient, zone: string): string {
  return csvLine([
    guardFormula(r.name),
    r.phoneDigits,
    capitalise(r.status || 'pending'),
    r.clicked ? 'Yes' : 'No',
    localMinute(r.queuedAt, zone),
    localMinute(r.sentAt, zone),
    localMinute(r.deliveredAt, zone),
    localMinute(r.readAt, zone),
    localMinute(r.failedAt, zone),
    lastEvent(r),
    guardFormula(r.error ?? ''),
  ]);
}

/** `broadcast-<id>-recipients-<YYYYMMDD-HHMMSS>.csv` (UTC). */
export function csvFileName(id: string, now: Date): string {
  const t = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `broadcast-${id}-recipients-${t}.csv`;
}
