'use client';

/** Pages shown around the current one: first, last, and two either side, with a gap marker between. */
export function pageWindow(page: number, pages: number): Array<number | 'gap'> {
  const keep = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2]);
  const out: Array<number | 'gap'> = [];
  let last = 0;
  for (const p of [...keep].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)) {
    if (p - last > 1) out.push('gap');
    out.push(p);
    last = p;
  }
  return out;
}
