/** Mirrors how the API derives a workspace address from its name, so the form can show what to expect. */
export function suggestSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : '';
}
