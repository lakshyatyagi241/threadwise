import {
  WALLET_LIMITS,
  bpsToPercent,
  majorToMicros,
  normalizeWalletCategory,
  normalizeWalletCountry,
  percentToBps,
  priceFromMargin,
  type MarginInput,
  type MarginRow,
  type RateRow,
  type SaveMarginsResult,
  type WalletCategory,
} from '@crm/contracts';

export type MarginCategory = '' | WalletCategory;

/**
 * Meta's cost for a country and category, found the way the billing engine finds it: the exact row, then the country with any
 * category, then the category in any country, then the default row; the first row that knows a cost answers. Null = unknown, so
 * the typed fixed price applies there and no margin price can be shown.
 */
export function metaCostFor(
  rates: readonly RateRow[],
  countryCode: string,
  category: string,
): string | null {
  const c = normalizeWalletCountry(countryCode);
  const k = normalizeWalletCategory(category);
  const seen = new Set<string>();
  for (const [cc, kk] of [
    [c, k],
    [c, ''],
    ['', k],
    ['', ''],
  ] as const) {
    const key = `${cc}|${kk}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = rates.find((r) => r.isActive && r.countryCode === cc && r.category === kk);
    if (row?.metaCost) return row.metaCost;
  }
  return null;
}

export type PriceCell =
  | { kind: 'unknown' }
  | { kind: 'invalid' }
  | { kind: 'ok'; priceMinor: number };

/** The customer price at a typed margin, live: the contract's `priceFromMargin` on Meta's cost, in hundredths. */
export function previewPrice(metaCost: string | null, margin: string): PriceCell {
  const bps = percentToBps(margin);
  if (bps === null) return { kind: 'invalid' };
  if (metaCost === null) return { kind: 'unknown' };
  const micros = majorToMicros(metaCost);
  if (micros === null) return { kind: 'unknown' };
  return { kind: 'ok', priceMinor: priceFromMargin(micros, bps) };
}

/** One line of the margin grid as it is shown: the stored row with the person's edit on top, or a row added in this session. */
export interface MarginGridRow {
  /** The margin's uuid, or `new-N` for a row that does not exist yet. */
  key: string;
  existing: boolean;
  countryCode: string;
  category: MarginCategory;
  /** Percent as typed ("25.00"). */
  margin: string;
  metaCost: string | null;
  price: PriceCell;
  dirty: boolean;
  /** Workspace overrides: staged for removal, sent with the reason on save. */
  removed: boolean;
  note: string | null;
  setBy: string | null;
}

export interface NewMarginRow {
  key: string;
  countryCode: string;
  category: MarginCategory;
  margin: string;
}

export interface MarginDraft {
  /** Edited percents of stored rows, by margin id. */
  edits: Record<string, string>;
  added: NewMarginRow[];
  /** Stored override ids staged for removal (workspace overrides only). */
  removed: string[];
  /** Why the server skipped a row, by row key, until the person edits it. */
  skipped: Record<string, string>;
  seq: number;
}

export const EMPTY_MARGIN_DRAFT: MarginDraft = {
  edits: {},
  added: [],
  removed: [],
  skipped: {},
  seq: 0,
};

export const marginKeyOf = (countryCode: string, category: string): string =>
  `${countryCode.trim().toUpperCase()}|${category}`;

export function addMarginRow(d: MarginDraft): MarginDraft {
  const seq = d.seq + 1;
  return {
    ...d,
    seq,
    added: [...d.added, { key: `new-${seq}`, countryCode: '', category: '', margin: '' }],
  };
}

export function removeNewMarginRow(d: MarginDraft, key: string): MarginDraft {
  const { [key]: _gone, ...skipped } = d.skipped;
  return { ...d, added: d.added.filter((r) => r.key !== key), skipped };
}

export function editMarginField(
  d: MarginDraft,
  key: string,
  field: 'margin' | 'countryCode' | 'category',
  value: string,
): MarginDraft {
  const { [key]: _cleared, ...skipped } = d.skipped;
  if (d.added.some((r) => r.key === key)) {
    return {
      ...d,
      skipped,
      added: d.added.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    };
  }
  if (field !== 'margin') return d;
  return { ...d, skipped, edits: { ...d.edits, [key]: value } };
}

export const stageRemoval = (d: MarginDraft, id: string): MarginDraft =>
  d.removed.includes(id) ? d : { ...d, removed: [...d.removed, id] };

export const undoRemoval = (d: MarginDraft, id: string): MarginDraft => ({
  ...d,
  removed: d.removed.filter((r) => r !== id),
});

/** A stored row was deleted on the server: nothing about it stays in the draft. */
export function forgetRow(d: MarginDraft, id: string): MarginDraft {
  const { [id]: _edit, ...edits } = d.edits;
  const { [id]: _skip, ...skipped } = d.skipped;
  return { ...d, edits, skipped, removed: d.removed.filter((r) => r !== id) };
}

/** Two typed margins are the same figure ("25" and "25.00"), compared as integer basis points; unreadable text compares as text. */
function sameMargin(a: string, b: string): boolean {
  const x = percentToBps(a);
  const y = percentToBps(b);
  return x !== null && y !== null ? x === y : a.trim() === b.trim();
}

export function marginGridRows(
  server: readonly MarginRow[],
  d: MarginDraft,
  costOf: (countryCode: string, category: string) => string | null,
): MarginGridRow[] {
  const stored = server.map((r): MarginGridRow => {
    const original = bpsToPercent(r.marginBps);
    const margin = d.edits[r.id] ?? original;
    const metaCost = r.metaCost ?? costOf(r.countryCode, r.category);
    return {
      key: r.id,
      existing: true,
      countryCode: r.countryCode,
      category: r.category,
      margin,
      metaCost,
      price: previewPrice(metaCost, margin),
      dirty: !sameMargin(margin, original),
      removed: d.removed.includes(r.id),
      note: r.note,
      setBy: r.setBy,
    };
  });
  const added = d.added.map((r): MarginGridRow => {
    const metaCost = costOf(r.countryCode, r.category);
    return {
      ...r,
      existing: false,
      metaCost,
      price: previewPrice(metaCost, r.margin),
      dirty: true,
      removed: false,
      note: null,
      setBy: null,
    };
  });
  return [...stored, ...added];
}

/** The contract's cap on rows in one save. */
export const MAX_MARGIN_ROWS_PER_SAVE = 500;

export type MarginProblem = 'margin' | 'duplicate';

/** Why a changed row cannot be sent (the contract's own percent rules, plus the duplicate check); null = fine. */
export function marginProblem(row: MarginGridRow, all: readonly MarginGridRow[]): MarginProblem | null {
  if (!row.dirty || row.removed) return null;
  if (percentToBps(row.margin) === null) return 'margin';
  if (!row.existing) {
    const key = marginKeyOf(row.countryCode, row.category);
    const same = all.filter((r) => !r.removed && marginKeyOf(r.countryCode, r.category) === key);
    // A new row repeating a stored row or an earlier new row would only ever lose to it ("first wins").
    if (same.length > 1 && same[0]!.key !== row.key) return 'duplicate';
  }
  return null;
}

export interface MarginSavePlan {
  /** What goes in the request, in order. */
  rows: MarginInput[];
  /** The grid row each request row came from, so a skipped index can be shown against its line. */
  keys: string[];
  /** Stored overrides to delete in the same request. */
  removeIds: string[];
  invalid: Array<{ key: string; problem: MarginProblem }>;
  tooMany: boolean;
}

/** Only changed and new rows are sent, with the percent as typed; nothing else about the grid goes on the wire. */
export function planMarginSave(rows: readonly MarginGridRow[]): MarginSavePlan {
  const plan: MarginSavePlan = { rows: [], keys: [], removeIds: [], invalid: [], tooMany: false };
  for (const r of rows) {
    if (r.existing && r.removed) {
      plan.removeIds.push(r.key);
      continue;
    }
    if (!r.dirty) continue;
    const problem = marginProblem(r, rows);
    if (problem) plan.invalid.push({ key: r.key, problem });
    else {
      plan.rows.push({
        countryCode: r.countryCode.trim().toUpperCase(),
        category: r.category,
        margin: r.margin.trim(),
      });
      plan.keys.push(r.key);
    }
  }
  plan.tooMany =
    plan.rows.length > MAX_MARGIN_ROWS_PER_SAVE || plan.removeIds.length > MAX_MARGIN_ROWS_PER_SAVE;
  return plan;
}

export const hasMarginChanges = (rows: readonly MarginGridRow[]): boolean =>
  rows.some((r) => r.dirty || r.removed);

/** After a save: saved rows are no longer drafts; skipped ones stay, with the server's reason. Staged removals are done. */
export function afterMarginSave(
  d: MarginDraft,
  plan: Pick<MarginSavePlan, 'keys' | 'removeIds'>,
  result: SaveMarginsResult,
): MarginDraft {
  const reasons = new Map(result.skipped.map((s) => [s.index, s.reason] as const));
  const next: MarginDraft = {
    ...d,
    edits: { ...d.edits },
    added: [...d.added],
    removed: d.removed.filter((id) => !plan.removeIds.includes(id)),
    skipped: {},
  };
  plan.keys.forEach((key, i) => {
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

export type ReasonProblem = 'short' | 'long';

/** The mandatory reason on a workspace override (kept in the audit log): 5 to 500 characters once trimmed. */
export function reasonProblem(note: string): ReasonProblem | null {
  const n = note.trim().length;
  if (n < WALLET_LIMITS.noteMin) return 'short';
  if (n > WALLET_LIMITS.noteMax) return 'long';
  return null;
}

/** Whether a workspace save may be sent: something changed, every changed row is fine, and the reason is valid. */
export function canSaveOverrides(
  rows: readonly MarginGridRow[],
  note: string,
): { ok: boolean; plan: MarginSavePlan } {
  const plan = planMarginSave(rows);
  const sendable = plan.rows.length + plan.removeIds.length > 0;
  return {
    ok: sendable && plan.invalid.length === 0 && !plan.tooMany && reasonProblem(note) === null,
    plan,
  };
}
