import type { SavedReply } from '@crm/contracts';

/**
 * Pure helpers of the saved-reply picker: where a `/shortcut` is being typed, which replies match it and in what order, and what
 * the composer text becomes when one is inserted. No React, no network, so the keyboard behaviour is testable on its own.
 */

/** A `/query` the caret is in: `start` is the index of the slash, `end` the caret. */
export interface SlashTrigger {
  start: number;
  end: number;
  query: string;
}

/**
 * Whether the caret sits inside a word that begins with `/` at the start of the text or right after a space or a new line, with no
 * space between the slash and the caret. `see a/b` and `https://x` are not triggers (the slash follows a character); `/` alone is, with
 * an empty query. Reference only looked at a slash typed into an empty box; this also finds one at the start of a later line.
 */
export function slashTrigger(text: string, caret: number): SlashTrigger | null {
  if (caret < 1 || caret > text.length) return null;
  let i = caret - 1;
  while (i >= 0 && !/\s/.test(text[i]!)) i -= 1;
  const start = i + 1;
  if (text[start] !== '/') return null;
  // A second slash (`//`, a URL) is not a shortcut.
  if (text[start + 1] === '/') return null;
  return { start, end: caret, query: text.slice(start + 1, caret) };
}

const fold = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The replies that match what was typed (shortcut, title or body, case and accent insensitive), best first: an exact shortcut, then a
 * shortcut that starts with it, then a title that starts with it, then the rest. Within a rank the most used comes first, and the caller's
 * own reply comes before a shared one with the same shortcut (Reference's "personal wins").
 */
export function rankReplies(replies: readonly SavedReply[], rawQuery: string): SavedReply[] {
  const q = fold(rawQuery.trim().replace(/^\/+/, ''));
  const score = (r: SavedReply): number => {
    if (q === '') return 4;
    const shortcut = fold(r.shortcut);
    if (shortcut === q) return 0;
    if (shortcut.startsWith(q)) return 1;
    if (fold(r.title).startsWith(q)) return 2;
    if (shortcut.includes(q) || fold(r.title).includes(q) || fold(r.body).includes(q)) return 3;
    return -1;
  };
  // A shortcut used by a shared and a personal reply is one entry in the ordering: the pair ranks by its best use, mine first.
  const usage = new Map<string, number>();
  for (const r of replies) usage.set(r.shortcut, Math.max(usage.get(r.shortcut) ?? 0, r.usedCount));
  return replies
    .map((r) => ({ r, s: score(r) }))
    .filter((x) => x.s >= 0)
    .sort(
      (a, b) =>
        a.s - b.s ||
        usage.get(b.r.shortcut)! - usage.get(a.r.shortcut)! ||
        a.r.shortcut.localeCompare(b.r.shortcut) ||
        Number(b.r.scope === 'mine') - Number(a.r.scope === 'mine'),
    )
    .map((x) => x.r);
}

export interface Insertion {
  text: string;
  /** Where the caret goes: right after the inserted reply. */
  caret: number;
}

/**
 * The composer text after inserting a reply in place of `range` (the typed `/query`, or the selection). `null` when the result would be
 * longer than the channel allows: the caller says so and the text stays as it was. A reply is inserted as typed text, never as markup.
 */
export function insertReply(
  text: string,
  range: { start: number; end: number },
  reply: string,
  max: number,
): Insertion | null {
  const before = text.slice(0, range.start);
  const after = text.slice(range.end);
  const next = `${before}${reply}${after}`;
  if (next.length > max) return null;
  return { text: next, caret: before.length + reply.length };
}

/** Moves the highlighted row with the arrow keys, wrapping at both ends. */
export function moveActive(index: number, count: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count <= 0) return 0;
  return key === 'ArrowDown' ? (index + 1) % count : (index - 1 + count) % count;
}

/** The ids the combobox points at, stable per reply. */
export const optionId = (listId: string, replyId: string): string => `${listId}-${replyId}`;
