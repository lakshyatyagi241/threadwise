/**
 * Placeholders in a template (WD-TPL-008). Operators author named tokens (`{{first_name}}`); storage and the Meta submission
 * are always positional (`{{1}}`, `{{2}}`). Pure, so the API and the form can share it.
 */

export interface VariableSlot {
  /** 1-based slot in the field's text. */
  num: number;
  /** The contact attribute that fills it, or the slot number when unmapped. */
  key: string;
  /** A real sample value for Meta's review, when the author gave one. */
  example?: string;
}

export interface VariableMap {
  header?: VariableSlot[];
  body?: VariableSlot[];
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Distinct tokens of a text in order of first appearance. */
export function tokensOf(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(TOKEN)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
  return seen;
}

/** Every occurrence counts (Meta's own count), not the distinct ones. */
export function countPlaceholders(text: string): number {
  return [...text.matchAll(TOKEN)].length;
}

/**
 * Rewrites each distinct token to its 1-based position of first appearance, per field. `{{2}} {{1}}` becomes `{{1}} {{2}}`;
 * tokens with spaces, dots or hyphens are not matched and stay literal (WaDesk behaviour, WD-TPL-008 rule 1).
 */
export function normalizePlaceholders(text: string): { text: string; tokens: string[] } {
  const tokens = tokensOf(text);
  return {
    text: text.replace(TOKEN, (_m, t: string) => `{{${tokens.indexOf(t) + 1}}}`),
    tokens,
  };
}

/** A slot per distinct token: the token's name is the attribute key, a numeric token maps to its own number. */
export function slotsFor(tokens: string[]): VariableSlot[] {
  return tokens.map((t, i) => ({ num: i + 1, key: t }));
}

/** Result of preparing the authored header/body/footer for storage. */
export interface PreparedText {
  header: string | null;
  body: string;
  footer: string | null;
  variableMap: VariableMap;
}

/**
 * Normalises the three fields independently (each numbers from 1) and derives the variable map from the RAW tokens, so the
 * attribute each slot reads from is kept. The footer takes no placeholders, so it is only passed through.
 */
export function prepareText(raw: {
  header?: string | null;
  body: string;
  footer?: string | null;
}): PreparedText {
  const h = raw.header ? normalizePlaceholders(raw.header) : null;
  const b = normalizePlaceholders(raw.body);
  const map: VariableMap = {};
  if (h && h.tokens.length) map.header = slotsFor(h.tokens);
  if (b.tokens.length) map.body = slotsFor(b.tokens);
  return { header: h?.text ?? null, body: b.text, footer: raw.footer ?? null, variableMap: map };
}

/** Numeric tokens present in a (normalised) text that are not 1..N contiguous: the gap Meta rejects. */
export function placeholderGaps(text: string): number[] {
  const nums = [
    ...new Set(
      tokensOf(text)
        .filter((t) => /^\d+$/.test(t))
        .map(Number),
    ),
  ].sort((a, b) => a - b);
  const gaps: number[] = [];
  nums.forEach((n, i) => {
    if (n !== i + 1) gaps.push(n);
  });
  return gaps;
}
