import { KB_RETRIEVAL } from '@crm/contracts';
import { MAX_CHUNKS_PER_SOURCE } from './kb.rules';

/**
 * Cuts an entry's text into passages for the search index. Pure.
 *
 * - Paragraphs (blank-line separated) are packed together up to `chars`, so a short note is one passage.
 * - A paragraph that starts a question ("Q: ...", how the FAQ entry is written) always starts a new passage: one question and its answer
 *   per passage, so the meaning of a passage is one question, not a blend of three.
 * - A paragraph longer than `chars` is split on sentence ends, and a sentence longer than that on spaces, then on characters.
 * - A passage that continues the one before it (not a question start) begins with the tail of that one, `overlap` characters, so an
 *   answer that sits on the cut is whole in at least one passage.
 */
export function chunkText(
  raw: string,
  chars: number = KB_RETRIEVAL.chunkChars,
  overlap: number = KB_RETRIEVAL.chunkOverlap,
): string[] {
  const text = raw.replaceAll('\u0000', '').replace(/\r\n?/g, '\n').trim();
  if (text === '') return [];

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
  const pieces = paragraphs.flatMap((p) => (p.length > chars ? splitLong(p, chars) : [p]));

  const out: Array<{ text: string; continues: boolean }> = [];
  let cur = '';
  let curContinues = false;
  const flush = (): void => {
    if (cur !== '') out.push({ text: cur, continues: curContinues });
    cur = '';
  };
  for (const piece of pieces) {
    const startsQuestion = /^Q:\s/.test(piece);
    if (cur !== '' && (startsQuestion || cur.length + 2 + piece.length > chars)) {
      flush();
      curContinues = !startsQuestion;
    }
    cur = cur === '' ? piece : `${cur}\n\n${piece}`;
  }
  flush();

  const result: string[] = [];
  out.forEach((c, i) => {
    const prev = i > 0 ? out[i - 1]!.text : '';
    const tail = c.continues && overlap > 0 && prev ? tailOf(prev, overlap) : '';
    result.push(tail ? `${tail}\n${c.text}` : c.text);
  });
  return result.slice(0, MAX_CHUNKS_PER_SOURCE);
}

/** The last `n` characters of `s`, starting at a word edge. */
function tailOf(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(s.length - n);
  const space = cut.search(/\s/);
  return (space >= 0 && space < n / 2 ? cut.slice(space + 1) : cut).trim();
}

function splitLong(p: string, chars: number): string[] {
  const sentences = p.split(/(?<=[.!?。！？])\s+/u);
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    for (const part of s.length > chars ? hardSplit(s, chars) : [s]) {
      if (cur !== '' && cur.length + 1 + part.length > chars) {
        out.push(cur);
        cur = '';
      }
      cur = cur === '' ? part : `${cur} ${part}`;
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

function hardSplit(s: string, chars: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > chars) {
    const space = rest.lastIndexOf(' ', chars);
    const at = space > chars / 2 ? space : chars;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest !== '') out.push(rest);
  return out;
}
