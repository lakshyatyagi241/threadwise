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
