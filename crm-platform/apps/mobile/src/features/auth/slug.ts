/** The accent marks (U+0300 to U+036F) left over once "é" is split into "e" and an accent. Built from codes so no invisible character sits in the source. */
const ACCENT_MARKS = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  'g',
);

/** Mirrors how the API derives a workspace address from its name, so the form can show what to expect. */
export function suggestSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(ACCENT_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : '';
}
