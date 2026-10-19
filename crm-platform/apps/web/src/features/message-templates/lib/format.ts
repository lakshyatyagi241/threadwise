/** The `n/max` counter and whether it is over. */
export const counter = (text: string, max: number) => ({
  used: text.length,
  max,
  over: text.length > max,
});

/** Wraps the selection in a marker (`*`, `_`, `~`, three backticks); an empty selection inserts the word "text". */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  marker: string,
  fallback = 'text',
): { value: string; start: number; end: number } {
  const picked = value.slice(start, end) || fallback;
  const next = value.slice(0, start) + marker + picked + marker + value.slice(end);
  return { value: next, start: start + marker.length, end: start + marker.length + picked.length };
}

/**
 * Turns a marker on or off around the selection. Already marked (inside the selection or
 * right outside it) → the marker is removed; otherwise it is wrapped like `wrapSelection`.
 */
export function toggleSelection(
  value: string,
  start: number,
  end: number,
  marker: string,
  fallback = 'text',
): { value: string; start: number; end: number } {
  const inner = value.slice(start, end);
  if (inner.length > marker.length * 2 && inner.startsWith(marker) && inner.endsWith(marker)) {
    const picked = inner.slice(marker.length, inner.length - marker.length);
    return {
      value: value.slice(0, start) + picked + value.slice(end),
      start,
      end: start + picked.length,
    };
  }
  const before = value.slice(start - marker.length, start);
  const after = value.slice(end, end + marker.length);
  if (start >= marker.length && before === marker && after === marker) {
    return {
      value: value.slice(0, start - marker.length) + inner + value.slice(end + marker.length),
      start: start - marker.length,
      end: end - marker.length,
    };
  }
  return wrapSelection(value, start, end, marker, fallback);
}
