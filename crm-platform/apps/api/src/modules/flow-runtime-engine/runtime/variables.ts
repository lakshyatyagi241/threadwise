/**
 * The variable bag of a run and the merge tags that read it (WD-FLR-017). One resolver and one interpolation serve every node;
 * WaDesk had two (a strong one for Message and Condition, a weak one for List, Media, Template and Webhook), so a tag such as
 * `{{customer.name}}` worked in one node and not the next.
 */
export type VariableBag = Record<string, unknown>;

const own = (o: unknown, k: string): boolean =>
  o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** The key an author typed, without one surrounding `{{ }}` or the spaces. */
export function bareKey(path: unknown): string {
  return String(path ?? '')
    .trim()
    .replace(/^\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .trim();
}

/**
 * Looks a path up: the exact key (the Sheets and AI nodes store flat dotted keys such as `customer.Customer_ID`), then the
 * lower-cased key, then a walk through nested objects with case-insensitive segments. Only OWN properties are read, so
 * `__proto__.x` or `customer.toString` never resolve.
 */
export function resolveVariable(bag: VariableBag, path: unknown): unknown {
  const key = bareKey(path);
  if (key === '') return undefined;
  if (own(bag, key)) return bag[key];
  const lower = key.toLowerCase();
  if (own(bag, lower)) return bag[lower];

  let cur: unknown = bag;
  for (const rawSeg of key.split('.')) {
    const seg = rawSeg.trim();
    if (cur === null || typeof cur !== 'object') return undefined;
    const o = cur as Record<string, unknown>;
    if (own(o, seg)) {
      cur = o[seg];
      continue;
    }
    const hit = Object.keys(o).find((k) => k.toLowerCase() === seg.toLowerCase());
    if (hit === undefined) return undefined;
    cur = o[hit];
  }
  return cur;
}

/** "Is set": present and not empty. A string is trimmed, an array or object must have content; the text "0" is set. */
export function isSet(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

/** How a value prints: a record as compact JSON (never "[object Object]"), an array comma-joined, nothing as empty. */
export function asText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object' && !Array.isArray(v)) {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

const TAG = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Replaces every `{{tag}}`; an unset tag renders empty. `escape` quotes the value for a JSON body (WD-FLR-017 port notes). */
export function interpolate(
  template: unknown,
  bag: VariableBag,
  options: { escape?: 'json' } = {},
): string {
  return String(template ?? '').replace(TAG, (_, k: string) => {
    const text = asText(resolveVariable(bag, k));
    return options.escape === 'json' ? JSON.stringify(text).slice(1, -1) : text;
  });
}

/** Flattens a record into dotted keys beside the object itself (depth 6, 200 keys), the shape the Webhook and Code nodes save. */
export function flattenInto(
  target: VariableBag,
  prefix: string,
  value: unknown,
  state: { n: number } = { n: 0 },
  depth = 0,
): void {
  if (state.n >= 200 || depth > 6) return;
  if (Array.isArray(value)) {
    target[`${prefix}.length`] = value.length;
    value.forEach((v, i) => flattenInto(target, `${prefix}.${i}`, v, state, depth + 1));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenInto(target, `${prefix}.${k}`, v, state, depth + 1);
    }
    return;
  }
  state.n += 1;
  target[prefix] = value;
}
