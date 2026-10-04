/** Plain-text helpers for listing content. Nothing here produces HTML: the screens render text nodes only. */

/** Blank lines separate paragraphs; single line breaks inside one are kept as spaces. Empty input gives no paragraphs. */
export function paragraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** True for an `https://` address that parses and has no credentials: the only kind of link the screens open. */
export function isHttpsLink(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.username === '' && u.password === '' && u.hostname !== '';
  } catch {
    return false;
  }
}

/** One or two letters for a logo that is missing or fails to load. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]!;
  const letters =
    words.length > 1
      ? `${Array.from(first)[0] ?? ''}${Array.from(words[1]!)[0] ?? ''}`
      : Array.from(first).slice(0, 2).join('');
  return letters.toUpperCase() || '?';
}
