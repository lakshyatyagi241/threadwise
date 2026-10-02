import {
  majorToMicros,
  microsToMajor,
  walletMajorToMinor,
  walletMinorToMajor,
  type RateRow,
  type SaveRatesResult,
  type UpsertRateInput,
  type WalletCategory,
} from '@crm/contracts';

export type GridCategory = '' | WalletCategory;

/** One line of the grid as it is shown: the stored row with the person's edits on top, or a row added in this session. */
export interface GridRow {
  /** The rate's uuid, or `new-N` for a row that does not exist yet. */
  key: string;
  existing: boolean;
  countryCode: string;
  category: GridCategory;
  /** Major units as typed ("12.00"); empty = blank. */
  price: string;
  metaCost: string;
  currency: string | null;
  dirty: boolean;
}

export interface NewRow {
  key: string;
  countryCode: string;
  category: GridCategory;
  price: string;
  metaCost: string;
}

export interface Draft {
  /** Edits to stored rows, by rate id. */
  edits: Record<string, { price?: string; metaCost?: string }>;
  added: NewRow[];
  /** Why the server skipped a row, by row key, until the person edits it. */
  skipped: Record<string, string>;
  seq: number;
}

export const EMPTY_DRAFT: Draft = { edits: {}, added: [], skipped: {}, seq: 0 };

export const keyOf = (countryCode: string, category: GridCategory): string =>
  `${countryCode.trim().toUpperCase()}|${category}`;

export function addRow(d: Draft): Draft {
  const seq = d.seq + 1;
  return {
    ...d,
    seq,
    added: [...d.added, { key: `new-${seq}`, countryCode: '', category: '', price: '', metaCost: '' }],
  };
}

export function removeAdded(d: Draft, key: string): Draft {
  const { [key]: _gone, ...skipped } = d.skipped;
  return { ...d, added: d.added.filter((r) => r.key !== key), skipped };
}

export function editField(
  d: Draft,
  key: string,
  field: 'price' | 'metaCost' | 'countryCode' | 'category',
  value: string,
): Draft {
  const { [key]: _cleared, ...skipped } = d.skipped;
  if (d.added.some((r) => r.key === key)) {
    return { ...d, skipped, added: d.added.map((r) => (r.key === key ? { ...r, [field]: value } : r)) };
  }
  if (field !== 'price' && field !== 'metaCost') return d;
  return { ...d, skipped, edits: { ...d.edits, [key]: { ...d.edits[key], [field]: value } } };
}

/** Two typed amounts are the same figure ("12" and "12.00"), compared as integers, never as floats. */
function sameAmount(a: string, b: string, parse: (s: string) => number | null): boolean {
  if (a.trim() === '' || b.trim() === '') return a.trim() === b.trim();
  const x = parse(a);
  const y = parse(b);
  return x !== null && y !== null ? x === y : a.trim() === b.trim();
}
const samePrice = (a: string, b: string) => sameAmount(a, b, (s) => walletMajorToMinor(s));
const sameCost = (a: string, b: string) => sameAmount(a, b, (s) => majorToMicros(s));

export function gridRows(server: readonly RateRow[], d: Draft): GridRow[] {
  const stored = server.map((r): GridRow => {
    const price = walletMinorToMajor(r.priceMinor);
    const metaCost = r.metaCost ?? '';
    const e = d.edits[r.id];
    const nextPrice = e?.price ?? price;
    const nextCost = e?.metaCost ?? metaCost;
    return {
      key: r.id,
      existing: true,
      countryCode: r.countryCode,
      category: r.category,
      price: nextPrice,
      metaCost: nextCost,
      currency: r.currency,
      dirty: !samePrice(nextPrice, price) || !sameCost(nextCost, metaCost),
    };
  });
  const added = d.added.map(
    (r): GridRow => ({
      ...r,
      existing: false,
      currency: null,
      dirty: r.price.trim() !== '' || r.metaCost.trim() !== '' || r.countryCode !== '' || r.category !== '',
    }),
  );
  return [...stored, ...added];
}

/** The contract's cap on rows in one save. */
export const MAX_ROWS_PER_SAVE = 500;

export type RowProblem = 'price' | 'metaCost' | 'country' | 'empty' | 'duplicate';

/** Why a changed row cannot be sent, by the contract's own schema plus the duplicate check; null = fine. */
export function rowProblem(row: GridRow, all: readonly GridRow[]): RowProblem | null {
  if (!row.dirty) return null;
  if (!row.existing) {
    const same = all.filter((r) => keyOf(r.countryCode, r.category) === keyOf(row.countryCode, row.category));
    // A new row repeating a stored row or an earlier new row would only ever lose to it ("first wins").
    if (same.length > 1 && same[0]!.key !== row.key) return 'duplicate';
  }
  const country = row.countryCode.trim();
  if (country !== '' && !/^[A-Za-z]{2}$/.test(country)) return 'country';
  const price = row.price.trim();
  const cost = row.metaCost.trim();
  if (price === '' && cost === '') return 'empty';
  if (price !== '' && walletMajorToMinor(price) === null) return 'price';
  if (cost !== '' && majorToMicros(cost) === null) return 'metaCost';
  return null;
}

export function toUpsert(row: GridRow): UpsertRateInput {
  const out: Record<string, unknown> = {
    countryCode: row.countryCode.trim().toUpperCase(),
    category: row.category,
    price: row.price.trim(),
    metaCost: row.metaCost.trim(),
  };
  if (row.currency) out.currency = row.currency;
  return out as unknown as UpsertRateInput;
}

export interface SavePlan {
  /** What goes in the request, in order. */
  rows: UpsertRateInput[];
  /** The grid row each request row came from, so a skipped index can be shown against its line. */
  keys: string[];
  /** Rows with a problem: nothing is sent while any exist. */
  invalid: Array<{ key: string; problem: RowProblem }>;
  /** More rows than one request takes (the contract allows 500). */
  tooMany: boolean;
}

/** Only changed and new rows are sent; a blank new row the person never touched is ignored. */
export function planSave(rows: readonly GridRow[]): SavePlan {
  const plan: SavePlan = { rows: [], keys: [], invalid: [], tooMany: false };
  for (const r of rows) {
    if (!r.dirty) continue;
    const problem = rowProblem(r, rows);
    if (problem) plan.invalid.push({ key: r.key, problem });
    else {
      plan.rows.push(toUpsert(r));
      plan.keys.push(r.key);
    }
  }
  plan.tooMany = plan.rows.length > MAX_ROWS_PER_SAVE;
  return plan;
}

/** After a save: saved rows are no longer drafts; skipped ones stay, with the server's reason. */
export function afterSave(d: Draft, keys: readonly string[], result: SaveRatesResult): Draft {
  const reasons = new Map(result.skipped.map((s) => [s.index, s.reason] as const));
  const next: Draft = { ...d, edits: { ...d.edits }, added: [...d.added], skipped: {} };
  keys.forEach((key, i) => {
    const reason = reasons.get(i);
    if (reason !== undefined) {
      next.skipped[key] = reason;
      return;
    }
    delete next.edits[key];
    next.added = next.added.filter((r) => r.key !== key);
  });
  return next;
}

export interface Margin {
  /** Charge minus cost, in millionths of the unit. */
  micros: number;
  /** "+11.99" / "-0.30" */
  text: string;
  /** Margin as a share of the cost, one decimal ("12.5"), or null when the cost is 0. */
  percent: string | null;
  tone: 'success' | 'danger' | 'neutral';
}

/** Your margin: what you charge minus what Meta charges you, from the typed texts. Null (shown as a dash) when either is blank or unreadable. */
export function marginOf(price: string, metaCost: string): Margin | null {
  if (price.trim() === '' || metaCost.trim() === '') return null;
  const p = majorToMicros(price);
  const c = majorToMicros(metaCost);
  if (p === null || c === null) return null;
  const micros = p - c;
  const abs = Math.abs(micros);
  const sign = micros > 0 ? '+' : micros < 0 ? '-' : '';
  let percent: string | null = null;
  if (c > 0) {
    // Integer arithmetic: tenths of a percent, rounded half away from zero.
    const tenths = Math.round((abs * 1000) / c);
    percent = `${sign}${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  return {
    micros,
    text: `${sign}${microsToMajor(abs)}`,
    percent,
    tone: micros > 0 ? 'success' : micros < 0 ? 'danger' : 'neutral',
  };
}

function trimMicros(abs: number): string {
  const text = microsToMajor(abs);
  return text;
}
