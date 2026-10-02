/** The people the @ picker offers: the workspace roster without the caller. */
export interface Mentionable {
  id: string;
  name: string;
  email: string;
}

export interface MentionQuery {
  /** Index of the `@` in the text. */
  start: number;
  /** What was typed after it. */
  query: string;
}

/**
 * Is the caret inside an `@word`? The `@` must start the text or follow whitespace, and only word characters may follow it
 * (so a name with a space narrows by its first word, as in Reference).
 */
export function detectMention(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@(\w*)$/.exec(before);
  if (!m) return null;
  const query = m[2] ?? '';
  return { start: caret - query.length - 1, query };
}

/** Case-insensitive substring of the name or the email, at most `max` rows, caller excluded. */
export function filterMentionable(
  people: Mentionable[],
  query: string,
  meId: string,
  max = 6,
): Mentionable[] {
  const q = query.trim().toLowerCase();
  return people
    .filter((p) => p.id !== meId)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
    .slice(0, max);
}

/** The token the composer inserts; `]` and newlines cannot be in the shown name. */
export function mentionToken(person: Pick<Mentionable, 'id' | 'name'>): string {
  const name =
    person.name
      .replace(/[\]\n]/g, ' ')
      .trim()
      .slice(0, 100) || 'member';
  return `@[${name}](${person.id})`;
}

/** Replaces the typed `@prefix` (from `start` to the caret) with the token and a space; returns the new text and caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  person: Pick<Mentionable, 'id' | 'name'>,
): { text: string; caret: number } {
  const token = `${mentionToken(person)} `;
  return { text: text.slice(0, start) + token + text.slice(caret), caret: start + token.length };
}

/** Wraps a move through the list, with wraparound. */
export function moveIndex(index: number, length: number, delta: 1 | -1): number {
  if (length === 0) return 0;
  return (index + delta + length) % length;
}
