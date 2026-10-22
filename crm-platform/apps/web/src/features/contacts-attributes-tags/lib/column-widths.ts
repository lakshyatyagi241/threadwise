/** Per-browser column widths the person dragged, by column id; a column with no entry keeps its built-in width. */
export type ColumnWidths = Record<string, number>;

export const COLUMN_WIDTHS_KEY = 'contacts.columnWidths';
export const MIN_COLUMN_W = 80;
export const MAX_COLUMN_W = 640;
/** One arrow-key press on a resize handle moves the edge this far. */
export const RESIZE_STEP = 16;

export const clampWidth = (w: number): number =>
  Math.min(MAX_COLUMN_W, Math.max(MIN_COLUMN_W, Math.round(w)));

/** The stored value as widths; anything that is not a map of numbers reads as none (nothing is trusted from storage). */
export function parseColumnWidths(raw: string | null): ColumnWidths {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const out: ColumnWidths = {};
    for (const [id, w] of Object.entries(value)) {
      if (typeof w === 'number' && Number.isFinite(w)) out[id] = clampWidth(w);
    }
    return out;
  } catch {
    return {};
  }
}

/** `null` when nothing is left to remember (so the key is removed). */
export function serializeColumnWidths(widths: ColumnWidths): string | null {
  return Object.keys(widths).length === 0 ? null : JSON.stringify(widths);
}

/** One column set to a width, or back to its built-in width with `null`. */
export function withColumnWidth(widths: ColumnWidths, id: string, w: number | null): ColumnWidths {
  const { [id]: _dropped, ...rest } = widths;
  return w === null ? rest : { ...rest, [id]: clampWidth(w) };
}
